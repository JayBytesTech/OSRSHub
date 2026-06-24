package com.osrshub.telemetry;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.inject.Provides;
import java.io.IOException;
import java.time.Instant;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.GameState;
import net.runelite.api.InventoryID;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.Player;
import net.runelite.api.Quest;
import net.runelite.api.QuestState;
import net.runelite.api.Skill;
import net.runelite.api.VarPlayer;
import net.runelite.api.events.ActorDeath;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.ItemContainerChanged;
import net.runelite.api.events.StatChanged;
import net.runelite.api.events.WidgetLoaded;
import net.runelite.api.widgets.InterfaceID;
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
 * Passive telemetry for the OSRS Hub. Feeds today:
 *   • bank value  → POST /api/bank (on bank-container change)
 *   • level-ups   → POST /api/events (hub-native events/1 feed; ADR 0005 Phase 1, replacing Dink)
 *   • deaths      → POST /api/events (ADR 0005 Phase 1)
 *   • quests      → POST /api/events (ADR 0005 Phase 1)
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

	@Inject private Client client;
	@Inject private ItemManager itemManager;
	@Inject private OkHttpClient okHttpClient;
	@Inject private OsrsHubConfig config;
	@Inject private Gson gson;

	// Debounce: the bank container fires repeatedly; only POST when the total actually changes.
	private long lastSentValue = -1;

	// Last seen REAL level per skill, to fire a level event only on an actual increase. Cleared on
	// login/hop so the post-login StatChanged batch re-baselines silently (no spurious level-ups).
	private final Map<Skill, Integer> levels = new EnumMap<>(Skill.class);

	// Quests already FINISHED for this character, baselined on login so we only emit on a *new*
	// completion. The quest-complete scroll (InterfaceID.QUEST_COMPLETED) is the trigger; we then scan
	// the Quest enum for which one flipped to FINISHED — canonical names, no widget-text parsing.
	// questScanTicks gives the completion varbit a few ticks to settle after the scroll appears.
	private final Set<Quest> finishedQuests = EnumSet.noneOf(Quest.class);
	private boolean questsBaselined = false;
	private int questScanTicks = 0;

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
			// Re-baseline quests for the (possibly different) character now logging in.
			finishedQuests.clear();
			questsBaselined = false;
			questScanTicks = 0;
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
	public void onActorDeath(ActorDeath event)
	{
		// Only the local player's death; ActorDeath also fires for every NPC/other player dying.
		final Player me = client.getLocalPlayer();
		if (me == null || event.getActor() != me)
		{
			return;
		}
		// Best-effort killer: whoever we were interacting with as we died. PvP if that's a player.
		final Actor target = me.getInteracting();
		final boolean isPvp = target instanceof Player;
		final String killer = target != null && target.getName() != null ? target.getName() : "";

		final JsonObject data = new JsonObject();
		data.addProperty("valueLost", 0);            // exact items-kept-on-death valuation is a later refinement
		data.addProperty("isPvp", isPvp);
		data.addProperty("killerName", killer.isEmpty() ? null : killer);

		final String occurredAt = Instant.now().toString();
		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "death");
		ev.addProperty("occurredAt", occurredAt);
		ev.addProperty("summary", "☠️ Died" + (killer.isEmpty() ? "" : " to " + killer));
		ev.addProperty("key", "death|" + occurredAt);   // each death is a distinct moment → time-keyed
		ev.add("data", data);
		postEvent(ev);
	}

	@Subscribe
	public void onWidgetLoaded(WidgetLoaded event)
	{
		// The quest-complete scroll just appeared — a quest finished. Scan over the next few ticks
		// (the completion varbit may settle a tick after the scroll renders).
		if (event.getGroupId() == InterfaceID.QUEST_COMPLETED)
		{
			questScanTicks = 3;
		}
	}

	@Subscribe
	public void onGameTick(GameTick event)
	{
		if (client.getGameState() != GameState.LOGGED_IN)
		{
			return;
		}
		// First logged-in tick: snapshot what's already done so login never emits historical quests.
		if (!questsBaselined)
		{
			for (Quest q : Quest.values())
			{
				if (q.getState(client) == QuestState.FINISHED)
				{
					finishedQuests.add(q);
				}
			}
			questsBaselined = true;
			return;
		}
		if (questScanTicks > 0)
		{
			questScanTicks--;
			scanForNewlyFinishedQuests();
		}
	}

	// Emit a quest event for any quest that has flipped to FINISHED since our baseline. The
	// finishedQuests set makes this idempotent across the multi-tick scan window (and re-fires).
	private void scanForNewlyFinishedQuests()
	{
		for (Quest q : Quest.values())
		{
			if (q.getState(client) != QuestState.FINISHED || !finishedQuests.add(q))
			{
				continue;
			}
			final String name = q.getName();
			final JsonObject data = new JsonObject();
			data.addProperty("questName", name);
			data.addProperty("questPoints", client.getVarpValue(VarPlayer.QUEST_POINTS));

			final JsonObject ev = new JsonObject();
			ev.addProperty("type", "quest");
			ev.addProperty("occurredAt", Instant.now().toString());
			ev.addProperty("summary", "📜 Completed quest: " + name);
			ev.addProperty("key", "quest|" + name);   // a quest completes once → idempotent
			ev.add("data", data);
			postEvent(ev);
		}
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
