package com.osrshub.telemetry;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.inject.Provides;
import java.io.IOException;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.GameState;
import net.runelite.api.InventoryID;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.Skill;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.ItemContainerChanged;
import net.runelite.api.events.StatChanged;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.game.ItemManager;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Passive telemetry for the OSRS Hub. Two feeds today:
 *   • bank value  → POST /api/bank (on bank-container change)
 *   • level-ups   → POST /api/events (hub-native events/1 feed; ADR 0005 Phase 1, replacing Dink)
 * Read-only — this plugin never sends input to or acts on the game (see docs/decisions/0002,
 * 0005 and ADR 0001 D2).
 */
@Slf4j
@PluginDescriptor(
	name = "OSRS Hub Telemetry",
	description = "Passively reports your bank value and game events to your local OSRS Hub.",
	tags = {"bank", "value", "telemetry", "hub", "events", "xp"}
)
public class OsrsHubPlugin extends Plugin
{
	private static final MediaType JSON = MediaType.parse("application/json");

	@Inject private ItemManager itemManager;
	@Inject private OkHttpClient okHttpClient;
	@Inject private OsrsHubConfig config;
	@Inject private Gson gson;

	// Debounce: the bank container fires repeatedly; only POST when the total actually changes.
	private long lastSentValue = -1;

	// Last seen REAL level per skill, to fire a level event only on an actual increase. Cleared on
	// login/hop so the post-login StatChanged batch re-baselines silently (no spurious level-ups).
	private final Map<Skill, Integer> levels = new EnumMap<>(Skill.class);

	@Provides
	OsrsHubConfig provideConfig(ConfigManager configManager)
	{
		return configManager.getConfig(OsrsHubConfig.class);
	}

	@Subscribe
	public void onGameStateChanged(GameStateChanged event)
	{
		final GameState state = event.getGameState();
		if (state == GameState.LOGGING_IN || state == GameState.HOPPING || state == GameState.LOGIN_SCREEN)
		{
			levels.clear();
		}
	}

	@Subscribe
	public void onStatChanged(StatChanged event)
	{
		final Skill skill = event.getSkill();
		if (skill == null)
		{
			return;
		}
		final int level = event.getLevel();              // real (XP-derived) level, 1..99
		final Integer prev = levels.put(skill, level);
		// First reading after login is just a baseline — don't emit. Only emit a genuine increase.
		if (prev == null || level <= prev || level > 99)
		{
			return;
		}
		final String name = skill.getName();
		final JsonObject data = new JsonObject();
		data.addProperty("skill", name);
		data.addProperty("level", level);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "level");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "🎉 Reached level " + level + " " + name);
		ev.addProperty("key", "level|" + name + "|" + level);   // a skill reaches a level once → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	@Subscribe
	public void onItemContainerChanged(ItemContainerChanged event)
	{
		if (event.getContainerId() != InventoryID.BANK.getId())
		{
			return;
		}
		final ItemContainer bankContainer = event.getItemContainer();
		if (bankContainer == null)
		{
			return;
		}

		long total = 0;
		for (Item item : bankContainer.getItems())
		{
			final int id = item.getId();
			if (id < 0)
			{
				continue;
			}
			// getItemPrice returns the GE price of the canonical (un-noted) item; coins price = 1.
			total += (long) itemManager.getItemPrice(id) * item.getQuantity();
		}

		if (total == lastSentValue)
		{
			return;
		}
		lastSentValue = total;
		postBankValue(total);
	}

	private void postBankValue(long value)
	{
		final JsonObject body = new JsonObject();
		body.addProperty("value", value);
		body.addProperty("source", "osrshub-plugin");
		postJson("/api/bank", body, "bank value");
	}

	// Wrap a single hub-native event in the events/1 envelope and POST it to the hub feed.
	private void postEvent(JsonObject event)
	{
		final JsonArray events = new JsonArray();
		events.add(event);
		final JsonObject body = new JsonObject();
		body.addProperty("schema", "events/1");
		body.add("events", events);
		postJson("/api/events", body, "event");
	}

	// Shared async POST to the configured hub, honoring the optional ingest token. Never blocks the
	// client thread on network I/O.
	private void postJson(String relPath, JsonObject body, String desc)
	{
		final String base = stripTrailingSlash(config.endpointBase());
		final String token = config.ingestToken() == null ? "" : config.ingestToken().trim();
		String url = base + relPath;
		if (!token.isEmpty())
		{
			url += "?token=" + token;
		}

		final Request request = new Request.Builder()
			.url(url)
			.post(RequestBody.create(JSON, gson.toJson(body)))
			.build();

		okHttpClient.newCall(request).enqueue(new Callback()
		{
			@Override
			public void onFailure(Call call, IOException e)
			{
				log.warn("OSRS Hub: {} POST failed", desc, e);
			}

			@Override
			public void onResponse(Call call, Response response)
			{
				try (Response r = response)
				{
					if (!r.isSuccessful())
					{
						log.warn("OSRS Hub: {} POST returned HTTP {}", desc, r.code());
					}
					else
					{
						log.debug("OSRS Hub: {} POST ok", desc);
					}
				}
			}
		});
	}

	private static String stripTrailingSlash(String s)
	{
		if (s == null || s.trim().isEmpty())
		{
			return "http://localhost:5173";
		}
		final String t = s.trim();
		return t.endsWith("/") ? t.substring(0, t.length() - 1) : t;
	}
}
