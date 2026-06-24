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

### C. Jagex account via the Bolt launcher (Linux) — the real-world recipe

If you log in with a **Jagex account** you can't use a bare dev client (it has no Jagex session) and
you **can't** just drop the jar in `~/.runelite/sideloaded-plugins/`. RuneLite computes
`developerMode = has("--developer-mode") && launcherVersion == null`, and sideloaded-plugin loading
is gated on `developerMode` — so **any** official launcher (Bolt included) force-disables it. The
working approach is to have **Bolt launch the `loadBuiltin` dev client** (`./gradlew run`), which
isn't gated by launcher version, while Bolt supplies the Jagex session via `JX_*` env vars.

1. Install **JDK 11** (`sudo pacman -S jdk11-openjdk`) and bootstrap the gradle wrapper once (path B).
2. Create a wrapper script, e.g. `~/.local/share/bolt-launcher/launch-runelite-dev.sh`:
   ```sh
   #!/bin/sh
   export HOME=/home/<you>/.local/share/bolt-launcher        # Bolt's .runelite profile
   export RL_USER_HOME=/home/<you>/.local/share/bolt-launcher
   export JAVA_HOME=/usr/lib/jvm/java-11-openjdk
   export GRADLE_USER_HOME=/home/<you>/.gradle
   cd /home/<you>/Projects/OSRSHub/plugin/osrshub-telemetry || exit 1
   exec ./gradlew run --console=plain --no-daemon
   ```
   `--no-daemon` matters: a cached daemon forks the client with a stale environment.
3. Point Bolt at it: set `runelite_launch_command` in `~/.config/bolt-launcher/launcher.json` to the
   script's path (back the file up first; revert by clearing it). Bolt must be **closed** when editing.
4. The `run` task (see `build.gradle`) forwards `user.home` + the `JX_*` session vars to the forked
   client, because Gradle's JavaExec otherwise strips them (no creds → no login; wrong home → no
   plugins). It also sets `enableAssertions` (`loadBuiltin` requires `-ea`).
5. Launch RuneLite through Bolt as usual. You get your full plugin list **plus** OSRS Hub Telemetry,
   logged into your Jagex account. Relaunching after a code change rebuilds automatically.

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
