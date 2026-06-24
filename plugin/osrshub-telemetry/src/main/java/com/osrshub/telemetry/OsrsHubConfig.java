package com.osrshub.telemetry;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;

/**
 * User-facing config for the OSRS Hub Telemetry plugin. Lets you point the plugin at your hub
 * without rebuilding, and supply a token if your hub sets INGEST_TOKEN.
 */
@ConfigGroup("osrshub")
public interface OsrsHubConfig extends Config
{
	@ConfigItem(
		keyName = "endpointBase",
		name = "Hub URL",
		description = "Base URL of your OSRS Hub, no trailing slash (default http://localhost:5173)."
	)
	default String endpointBase()
	{
		return "http://localhost:5173";
	}

	@ConfigItem(
		keyName = "ingestToken",
		name = "Ingest token",
		description = "Optional. Only needed if your hub sets INGEST_TOKEN; leave blank otherwise."
	)
	default String ingestToken()
	{
		return "";
	}

	@ConfigItem(
		keyName = "lootMinValue",
		name = "Min loot value",
		description = "Only report a loot drop whose total GE value is at least this many gp (keeps trash off the timeline)."
	)
	default int lootMinValue()
	{
		return 25000;
	}

	@ConfigItem(
		keyName = "sessionIdleMinutes",
		name = "Session idle minutes",
		description = "Active-time pauses after this many minutes without an XP gain, so AFK time doesn't dilute your XP/hr & GP/hr."
	)
	default int sessionIdleMinutes()
	{
		return 5;
	}
}
