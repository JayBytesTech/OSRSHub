package com.osrshub.telemetry;

import net.runelite.client.RuneLite;
import net.runelite.client.externalplugins.ExternalPluginManager;

/**
 * Dev launcher: starts a RuneLite client with this plugin side-loaded as a built-in. This is the
 * canonical way to run an out-of-tree RuneLite plugin locally (same pattern as runelite/example-plugin).
 * Run via `gradle run`, or right-click → Run in your IDE.
 */
public class OsrsHubPluginTest
{
	public static void main(String[] args) throws Exception
	{
		ExternalPluginManager.loadBuiltin(OsrsHubPlugin.class);
		RuneLite.main(args);
	}
}
