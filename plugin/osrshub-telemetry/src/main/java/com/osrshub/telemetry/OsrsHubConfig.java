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
}
