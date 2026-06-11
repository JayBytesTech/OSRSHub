package com.osrshub.telemetry;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.inject.Provides;
import java.io.IOException;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.InventoryID;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.events.ItemContainerChanged;
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
 * Passive telemetry: when the bank container changes (i.e. the bank is open / its contents update),
 * sum the GE value of every item and POST it to the hub's /api/bank endpoint. Read-only — this
 * plugin never sends input to or acts on the game (see docs/decisions/0002 and ADR 0001 D2).
 */
@Slf4j
@PluginDescriptor(
	name = "OSRS Hub Telemetry",
	description = "Passively reports your bank value to your local OSRS Hub.",
	tags = {"bank", "value", "telemetry", "hub"}
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

	@Provides
	OsrsHubConfig provideConfig(ConfigManager configManager)
	{
		return configManager.getConfig(OsrsHubConfig.class);
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
		final String base = stripTrailingSlash(config.endpointBase());
		final String token = config.ingestToken() == null ? "" : config.ingestToken().trim();
		String url = base + "/api/bank";
		if (!token.isEmpty())
		{
			url += "?token=" + token;
		}

		final JsonObject body = new JsonObject();
		body.addProperty("value", value);
		body.addProperty("source", "osrshub-plugin");

		final Request request = new Request.Builder()
			.url(url)
			.post(RequestBody.create(JSON, gson.toJson(body)))
			.build();

		// Async — never block the client thread on network I/O.
		okHttpClient.newCall(request).enqueue(new Callback()
		{
			@Override
			public void onFailure(Call call, IOException e)
			{
				log.warn("OSRS Hub: bank value POST failed", e);
			}

			@Override
			public void onResponse(Call call, Response response)
			{
				try (Response r = response)
				{
					if (!r.isSuccessful())
					{
						log.warn("OSRS Hub: bank value POST returned HTTP {}", r.code());
					}
					else
					{
						log.debug("OSRS Hub: reported bank value {}", value);
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
