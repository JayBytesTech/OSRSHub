# OSRS Hub Telemetry (RuneLite plugin)

A small, **passive** RuneLite plugin that reports your **bank value** to your local OSRS Hub. When
your bank is open and its contents change, the plugin sums the GE value of every item and POSTs it
to the hub's `POST /api/bank`. The hub stores one point per day (latest reading wins) and charts it
as the **🏦 Bank value** series on the Progress tab.

It is **read-only**: it observes the bank container and sends one HTTP request. It never sends input
to the game or automates anything (see `docs/decisions/0002-custom-runelite-plugin.md`).

This plugin is **side-loaded** for personal use — it is *not* published to the RuneLite Plugin Hub
(the Hub forbids arbitrary localhost POSTing and requires public review).

## What you need
- **JDK 11** (RuneLite builds against Java 11). Verify with `java -version`.
- Your OSRS Hub running locally (`npm start` → http://localhost:5173).

## Run it (two paths)

### A. IntelliJ IDEA (recommended — no Gradle wrapper needed)
1. *File → Open…* and select this folder (`plugin/osrshub-telemetry`). IntelliJ imports the Gradle project.
2. Open `src/test/java/com/osrshub/telemetry/OsrsHubPluginTest.java`.
3. Click the green ▶ next to `main(...)`. A RuneLite dev client launches with the plugin loaded.

### B. Command line (needs a system Gradle once)
The binary `gradle-wrapper.jar` isn't committed, so generate the wrapper one time, then run:
```bash
cd plugin/osrshub-telemetry
gradle wrapper        # one-time: creates ./gradlew (uses the version in gradle-wrapper.properties)
./gradlew run         # Windows: .\gradlew.bat run
```
`run` launches a RuneLite dev client with the plugin side-loaded.

## Use it
1. In the running RuneLite client, log into OSRS.
2. Make sure the hub is running. If you changed the hub's port or set `INGEST_TOKEN`, open the
   plugin's config (the **OSRS Hub Telemetry** entry in the RuneLite sidebar config) and set
   **Hub URL** / **Ingest token**.
3. **Open, then close, your bank.** That triggers a bank-container change.
4. You should see a line in the hub's server console:
   ```
   [bank] value=123,456,789 account=<your RSN>
   ```
5. On the hub's **Progress** tab, pick **🏦 Bank value** from the chart dropdown — your point appears
   (the trend fills in across days as you bank).

## Notes & limits
- Bank value reflects **banked items only** — it excludes worn equipment and inventory. A truer
  net-worth figure (bank + equipment + inventory) is a planned follow-up.
- It posts to whichever account is **current** in the hub (same behavior as the Dink integration).
- GE prices are RuneLite's cached wiki prices; untradeables and a few edge items may value at 0.
- True GP/hr (session XP/gp rates) is **not** in this version — it's the next plugin slice.
