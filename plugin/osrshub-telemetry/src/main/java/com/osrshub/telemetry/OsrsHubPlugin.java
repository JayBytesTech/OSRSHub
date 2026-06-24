package com.osrshub.telemetry;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.inject.Provides;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.Actor;
import net.runelite.api.ChatMessageType;
import net.runelite.api.Client;
import net.runelite.api.GameState;
import net.runelite.api.InventoryID;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.NPC;
import net.runelite.api.Player;
import net.runelite.api.Quest;
import net.runelite.api.QuestState;
import net.runelite.api.Skill;
import net.runelite.api.VarPlayer;
import net.runelite.api.Varbits;
import net.runelite.api.events.ActorDeath;
import net.runelite.api.events.ChatMessage;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.ItemContainerChanged;
import net.runelite.api.events.StatChanged;
import net.runelite.api.events.VarbitChanged;
import net.runelite.api.events.WidgetLoaded;
import net.runelite.api.widgets.InterfaceID;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.events.NpcLootReceived;
import net.runelite.client.events.PlayerLootReceived;
import net.runelite.client.game.ItemManager;
import net.runelite.client.game.ItemStack;
import net.runelite.client.plugins.loottracker.LootReceived;
import net.runelite.http.api.loottracker.LootRecordType;
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
 *   • diaries     → POST /api/events (ADR 0005 Phase 1)
 *   • combat achs → POST /api/events (ADR 0005 Phase 1)
 *   • clues       → POST /api/events (ADR 0005 Phase 1)
 *   • pets        → POST /api/events (ADR 0005 Phase 1)
 *   • slayer      → POST /api/events (ADR 0005 Phase 1)
 *   • kill counts → POST /api/events (ADR 0005 Phase 1)
 *   • loot        → POST /api/events (ADR 0005 Phase 1; min-value gated)
 *   • collection  → POST /api/events (ADR 0005 Phase 1)
 *   • sessions    → POST /api/sessions (ADR 0006 Phase 2; XP/hr from idle-gated active time)
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

	// Combat-task completion chat message, e.g.
	//   "Congratulations, you've completed an Elite combat task: <col=06600c>Peach Conjurer</col>."
	// Same shape RuneLite's own ScreenshotPlugin parses. Captures the tier word and the task name.
	private static final Pattern COMBAT_ACHIEVEMENT_PATTERN = Pattern.compile(
		"Congratulations, you've completed an? (?<tier>\\w+) combat task: <col=[0-9a-f]+>(?<task>.+)</col>");

	// Clue casket reward message, e.g. "You have completed 42 medium Treasure Trails."
	// Captures the running per-tier completion count and the tier word (lower-case in the message).
	private static final Pattern CLUE_PATTERN = Pattern.compile(
		"You have completed (?<count>[0-9,]+) (?<tier>\\w+) Treasure Trails?");

	// Pet drop messages. The game never names the pet here (so neither can we yet — petName is left
	// null, a later refinement). A new pet either follows you or is stuffed into your pack; the
	// "would have been followed" variant means you rolled a pet you already own (a duplicate).
	private static final Pattern PET_DUPLICATE_PATTERN = Pattern.compile(
		"You (?:have a funny feeling like you would have been followed|feel something weird sneaking into your backpack, but you already own)");
	private static final Pattern PET_PATTERN = Pattern.compile(
		"You (?:have a funny feeling like you're being followed|feel something weird sneaking into your backpack)");

	// Slayer. The completion line carries the count + (optional) points but never names the monster;
	// the monster name only appears in the assignment line, so we remember it from there. Best-effort:
	// if the plugin started mid-task we never saw the assignment and degrade to a generic name.
	private static final Pattern SLAYER_ASSIGN_PATTERN = Pattern.compile(
		"You(?:'re| have been) assigned to kill (?:[\\d,]+ )?(?<name>.+?)(?: (?:in|on) (?:the )?.+?)?; only [\\d,]+ more to go");
	private static final Pattern SLAYER_COMPLETE_PATTERN = Pattern.compile(
		"You've completed (?<count>[\\d,]+) (?:Wilderness )?tasks?(?: in a row)?(?:.*?received (?<points>[\\d,]+) points?)?");

	// Kill-count lines. Covers regular bosses ("Your Zulrah kill/success count is: <col>N"),
	// chest activities ("Your Barrows chest count is: …"), and raids ("Your completed Chambers of
	// Xeric count is: …"). The lower-case kill/success/chest qualifier is stripped from the name;
	// proper-cased words (e.g. "Lunar Chest") stay part of the boss name.
	private static final Pattern KILL_COUNT_PATTERN = Pattern.compile(
		"Your (?:completed )?(?<boss>.+?)(?: (?:kill|success|chest))? count is:? ?(?:<col=[0-9a-f]{6}>)?(?<count>[0-9,]+)");

	// Collection-log unlock. Requires the in-game "New addition notification" setting enabled (same
	// prerequisite Dink has). The slot counts aren't in the message, so they're left null.
	private static final Pattern COLLECTION_LOG_PATTERN = Pattern.compile(
		"New item added to your collection log: (?<item>.+?)\\.?$");

	// Each Achievement-Diary tier sets a dedicated completion varbit. Map varbit id → {region, tier}
	// where region/tier match public/diary-data.json exactly so the hub's diary auto-tick lights up.
	private static final Map<Integer, String[]> DIARY_VARBITS = buildDiaryVarbits();

	private static Map<Integer, String[]> buildDiaryVarbits()
	{
		final Map<Integer, String[]> m = new HashMap<>();
		putDiary(m, "Ardougne", Varbits.DIARY_ARDOUGNE_EASY, Varbits.DIARY_ARDOUGNE_MEDIUM, Varbits.DIARY_ARDOUGNE_HARD, Varbits.DIARY_ARDOUGNE_ELITE);
		putDiary(m, "Desert", Varbits.DIARY_DESERT_EASY, Varbits.DIARY_DESERT_MEDIUM, Varbits.DIARY_DESERT_HARD, Varbits.DIARY_DESERT_ELITE);
		putDiary(m, "Falador", Varbits.DIARY_FALADOR_EASY, Varbits.DIARY_FALADOR_MEDIUM, Varbits.DIARY_FALADOR_HARD, Varbits.DIARY_FALADOR_ELITE);
		putDiary(m, "Fremennik", Varbits.DIARY_FREMENNIK_EASY, Varbits.DIARY_FREMENNIK_MEDIUM, Varbits.DIARY_FREMENNIK_HARD, Varbits.DIARY_FREMENNIK_ELITE);
		putDiary(m, "Kandarin", Varbits.DIARY_KANDARIN_EASY, Varbits.DIARY_KANDARIN_MEDIUM, Varbits.DIARY_KANDARIN_HARD, Varbits.DIARY_KANDARIN_ELITE);
		putDiary(m, "Karamja", Varbits.DIARY_KARAMJA_EASY, Varbits.DIARY_KARAMJA_MEDIUM, Varbits.DIARY_KARAMJA_HARD, Varbits.DIARY_KARAMJA_ELITE);
		putDiary(m, "Kourend & Kebos", Varbits.DIARY_KOUREND_EASY, Varbits.DIARY_KOUREND_MEDIUM, Varbits.DIARY_KOUREND_HARD, Varbits.DIARY_KOUREND_ELITE);
		putDiary(m, "Lumbridge & Draynor", Varbits.DIARY_LUMBRIDGE_EASY, Varbits.DIARY_LUMBRIDGE_MEDIUM, Varbits.DIARY_LUMBRIDGE_HARD, Varbits.DIARY_LUMBRIDGE_ELITE);
		putDiary(m, "Morytania", Varbits.DIARY_MORYTANIA_EASY, Varbits.DIARY_MORYTANIA_MEDIUM, Varbits.DIARY_MORYTANIA_HARD, Varbits.DIARY_MORYTANIA_ELITE);
		putDiary(m, "Varrock", Varbits.DIARY_VARROCK_EASY, Varbits.DIARY_VARROCK_MEDIUM, Varbits.DIARY_VARROCK_HARD, Varbits.DIARY_VARROCK_ELITE);
		putDiary(m, "Western Provinces", Varbits.DIARY_WESTERN_EASY, Varbits.DIARY_WESTERN_MEDIUM, Varbits.DIARY_WESTERN_HARD, Varbits.DIARY_WESTERN_ELITE);
		putDiary(m, "Wilderness", Varbits.DIARY_WILDERNESS_EASY, Varbits.DIARY_WILDERNESS_MEDIUM, Varbits.DIARY_WILDERNESS_HARD, Varbits.DIARY_WILDERNESS_ELITE);
		return m;
	}

	private static void putDiary(Map<Integer, String[]> m, String region, int easy, int med, int hard, int elite)
	{
		m.put(easy, new String[]{region, "Easy"});
		m.put(med, new String[]{region, "Medium"});
		m.put(hard, new String[]{region, "Hard"});
		m.put(elite, new String[]{region, "Elite"});
	}

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

	// Diary-tier varbit ids already complete at login, so we only emit on a *new* tier completion.
	private final Set<Integer> completedDiaries = new HashSet<>();
	private boolean diariesBaselined = false;

	// Baseline scan (ADR 0003): post a full skills/quests/diaries dump once per login so an established
	// account's existing state imports wholesale (first sight) or surfaces a confirm-diff (known char).
	private boolean scanPostedThisLogin = false;

	// Current Slayer task name, learned from the assignment chat line and reported on completion.
	private String currentSlayerTask = null;

	// Play-session tracking (ADR 0006 Phase 2). A session spans login→logout (world hops keep it
	// going). startTotalXp is baselined on the first tick; total XP gained = current − start. Active
	// time is idle-gated: only the gap between consecutive XP gains counts, capped at the idle
	// threshold, so AFK doesn't dilute XP/hr. Posted periodically while playing + finally on logout.
	private static final int SESSION_POST_TICKS = 100;   // ~60s at 0.6s/tick
	private boolean sessionActive = false;
	private boolean sessionPendingBaseline = false;
	private String sessionId = null;
	private String sessionStartedAt = null;
	private long startTotalXp = 0;
	private long currentTotalXp = 0;
	private long sessionActiveMs = 0;
	private long lastXpGainAt = 0;
	private int sessionPostTicks = 0;

	// Per-skill XP baseline + latest reading → per-skill gains = current − start (ADR 0006 2B). We track
	// current on each StatChanged (not read from the client at post time) so the logout final post is
	// accurate even after the client has begun tearing down, and multi-skill ticks are all captured.
	private final Map<Skill, Integer> sessionStartXp = new EnumMap<>(Skill.class);
	private final Map<Skill, Integer> sessionCurrentXp = new EnumMap<>(Skill.class);

	// Value of loot received this session (Phase-1 valuation) → feeds GP/hr alongside gatheredValue.
	private long sessionLootValue = 0;

	// Resource counter (ADR 0006 D5): attribute an inventory increase to gathering ONLY when a
	// gathering-skill XP gain fired on the same tick. Processing skills (Cooking/Fletching/…) are
	// excluded by restricting to GATHERING_SKILLS, so a crafted product is never counted as "gathered".
	private static final Set<Skill> GATHERING_SKILLS =
		EnumSet.of(Skill.WOODCUTTING, Skill.MINING, Skill.FISHING, Skill.HUNTER, Skill.FARMING);
	private final Map<Integer, Integer> invSnapshot = new HashMap<>();   // itemId → qty (inventory)
	private boolean invSnapshotReady = false;
	private Skill tickGatherSkill = null;                                // gathering XP this tick?
	private final Map<Integer, Integer> tickInvGains = new HashMap<>();  // inv gains awaiting correlation
	private final Map<String, Integer> sessionResources = new HashMap<>(); // itemName → qty gathered
	private long sessionGatheredValue = 0;

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
			// Re-baseline quests + diaries for the (possibly different) character now logging in.
			finishedQuests.clear();
			questsBaselined = false;
			questScanTicks = 0;
			completedDiaries.clear();
			diariesBaselined = false;
		}
		// End the play session on logout (LOGIN_SCREEN). A world hop is HOPPING, not LOGIN_SCREEN, so
		// sessions correctly survive hops. Session START happens in onGameTick (handles login + the
		// plugin being enabled mid-session).
		if (state == GameState.LOGIN_SCREEN)
		{
			scanPostedThisLogin = false;   // re-scan on the next login (survives world hops, which are HOPPING)
			if (sessionActive)
			{
				endSession();
			}
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
		// Session active-time + total-XP accounting (idle-gated). Counted only on a real overall-XP
		// increase, so the post-login / post-hop StatChanged replay (XP unchanged) adds nothing.
		if (sessionActive && !sessionPendingBaseline)
		{
			sessionCurrentXp.put(skill, event.getXp());   // authoritative latest XP for this skill
			final long overall = client.getOverallExperience();
			if (overall > currentTotalXp)
			{
				final long now = System.currentTimeMillis();
				if (lastXpGainAt > 0)
				{
					sessionActiveMs += Math.min(now - lastXpGainAt, idleThresholdMs());
				}
				lastXpGainAt = now;
				currentTotalXp = overall;

				// Gathering attribution: mark the tick, and if an inventory gain already arrived this
				// tick (events can fire in either order), attribute it now.
				if (GATHERING_SKILLS.contains(skill))
				{
					tickGatherSkill = skill;
					if (!tickInvGains.isEmpty())
					{
						attributeGathered(tickInvGains);
						tickInvGains.clear();
					}
				}
			}
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
		// Session lifecycle (independent of the quest/diary baseline, which re-runs on world hop —
		// sessions must NOT restart on a hop). Start on first logged-in tick (or when the plugin is
		// enabled mid-session); baseline start XP once; post a live update every ~60s.
		if (!sessionActive)
		{
			startSession();
		}
		if (sessionPendingBaseline)
		{
			startTotalXp = client.getOverallExperience();
			currentTotalXp = startTotalXp;
			for (Skill sk : Skill.values())
			{
				if (sk != Skill.OVERALL)
				{
					final int xp = client.getSkillExperience(sk);
					sessionStartXp.put(sk, xp);
					sessionCurrentXp.put(sk, xp);
				}
			}
			snapshotInventory();   // so the first inventory change diffs against a real baseline
			sessionPendingBaseline = false;
		}
		else if (++sessionPostTicks >= SESSION_POST_TICKS)
		{
			sessionPostTicks = 0;
			postSession(false);
		}
		// First logged-in tick: snapshot what's already done so login never emits historical progress.
		if (!questsBaselined)
		{
			for (Quest q : Quest.values())
			{
				if (q.getState(client) == QuestState.FINISHED)
				{
					finishedQuests.add(q);
				}
			}
			for (int varbit : DIARY_VARBITS.keySet())
			{
				if (client.getVarbitValue(varbit) > 0)
				{
					completedDiaries.add(varbit);
				}
			}
			questsBaselined = true;
			diariesBaselined = true;
			if (!scanPostedThisLogin)
			{
				postBaselineScan();   // once per login (the gate isn't reset on hop)
				scanPostedThisLogin = true;
			}
			return;
		}
		if (questScanTicks > 0)
		{
			questScanTicks--;
			scanForNewlyFinishedQuests();
		}
		// End-of-tick reset for the gathering correlation window: a one-tick window means an inventory
		// gain on a tick with no gathering XP (e.g. a bank withdrawal) is discarded, not misattributed.
		tickGatherSkill = null;
		tickInvGains.clear();
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

	// Baseline scan (ADR 0003): a full skills/quests/diaries dump → POST /api/scan. The server applies
	// it wholesale on first sight, or stores a confirm-diff for a known account. Reuses the same
	// game-state reads as the incremental emitters. CAs/collection-log/stats are deferred (varbit TODO).
	private void postBaselineScan()
	{
		final JsonArray skills = new JsonArray();
		for (Skill sk : Skill.values())
		{
			if (sk == Skill.OVERALL)
			{
				continue;
			}
			final JsonObject s = new JsonObject();
			s.addProperty("skill", sk.getName());
			s.addProperty("level", client.getRealSkillLevel(sk));
			s.addProperty("xp", client.getSkillExperience(sk));
			skills.add(s);
		}

		final JsonObject quests = new JsonObject();   // {name: "FINISHED"|"IN_PROGRESS"} (NOT_STARTED omitted)
		for (Quest q : Quest.values())
		{
			final QuestState st = q.getState(client);
			if (st == QuestState.FINISHED)
			{
				quests.addProperty(q.getName(), "FINISHED");
			}
			else if (st == QuestState.IN_PROGRESS)
			{
				quests.addProperty(q.getName(), "IN_PROGRESS");
			}
		}

		final JsonArray tiers = new JsonArray();
		for (Map.Entry<Integer, String[]> e : DIARY_VARBITS.entrySet())
		{
			if (client.getVarbitValue(e.getKey()) > 0)
			{
				final JsonObject t = new JsonObject();
				t.addProperty("region", e.getValue()[0]);
				t.addProperty("tier", e.getValue()[1]);
				t.addProperty("done", true);
				tiers.add(t);
			}
		}
		final JsonObject diaries = new JsonObject();
		diaries.add("tiers", tiers);

		// Scalar stats → profile_stats (current values, latest-wins). Slayer task NAME isn't exposed
		// here (only a creature index), so it's left to the incremental slayer emitter.
		final JsonObject stats = new JsonObject();
		stats.addProperty("slayer.points", client.getVarbitValue(Varbits.SLAYER_POINTS));
		stats.addProperty("slayer.streak", client.getVarbitValue(Varbits.SLAYER_TASK_STREAK));
		stats.addProperty("questPoints", client.getVarpValue(VarPlayer.QUEST_POINTS));

		final JsonObject dump = new JsonObject();
		dump.addProperty("schema", "scan/1");
		dump.add("skills", skills);
		dump.add("quests", quests);
		dump.add("diaries", diaries);
		dump.add("stats", stats);
		postJson("/api/scan", dump, "scan");
	}

	@Subscribe
	public void onVarbitChanged(VarbitChanged event)
	{
		// A diary tier's completion varbit just flipped. Emit once per newly-completed tier.
		if (!diariesBaselined)
		{
			return;
		}
		final String[] regionTier = DIARY_VARBITS.get(event.getVarbitId());
		if (regionTier == null || event.getValue() <= 0)
		{
			return;
		}
		if (!completedDiaries.add(event.getVarbitId()))
		{
			return;   // already known complete → idempotent
		}
		emitDiary(regionTier[0], regionTier[1]);
	}

	private void emitDiary(String region, String tier)
	{
		final JsonObject data = new JsonObject();
		data.addProperty("region", region);
		data.addProperty("tier", tier);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "diary");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "📖 " + region + " " + tier + " diary complete");
		ev.addProperty("key", "diary|" + region + "|" + tier);   // a tier completes once → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	@Subscribe
	public void onChatMessage(ChatMessage event)
	{
		// Combat-achievement + clue completions arrive as game messages. No baseline needed — these
		// only fire on a fresh completion, never replayed on login.
		if (event.getType() != ChatMessageType.GAMEMESSAGE)
		{
			return;
		}
		final String message = event.getMessage();

		final Matcher ca = COMBAT_ACHIEVEMENT_PATTERN.matcher(message);
		if (ca.find())
		{
			emitCombatAchievement(ca.group("task").trim(), ca.group("tier"));
			return;
		}

		final Matcher clue = CLUE_PATTERN.matcher(message);
		if (clue.find())
		{
			final int count = Integer.parseInt(clue.group("count").replace(",", ""));
			emitClue(capitalize(clue.group("tier")), count);
			return;
		}

		// Duplicate check first — its text is a near-superset of the normal "sneaking into your pack".
		if (PET_DUPLICATE_PATTERN.matcher(message).find())
		{
			emitPet(true);
			return;
		}
		if (PET_PATTERN.matcher(message).find())
		{
			emitPet(false);
			return;
		}

		// Slayer assignment — just remember the task name for the eventual completion event.
		final Matcher assign = SLAYER_ASSIGN_PATTERN.matcher(message);
		if (assign.find())
		{
			currentSlayerTask = assign.group("name").trim();
			return;
		}

		final Matcher slayer = SLAYER_COMPLETE_PATTERN.matcher(message);
		if (slayer.find())
		{
			emitSlayer(currentSlayerTask, slayer.group("count"), slayer.group("points"));
			return;
		}

		final Matcher kc = KILL_COUNT_PATTERN.matcher(message);
		if (kc.find())
		{
			emitKillCount(kc.group("boss").trim(), Integer.parseInt(kc.group("count").replace(",", "")));
			return;
		}

		final Matcher clog = COLLECTION_LOG_PATTERN.matcher(message);
		if (clog.find())
		{
			emitCollectionLog(clog.group("item").trim());
		}
	}

	private void emitCombatAchievement(String task, String tier)
	{
		final JsonObject data = new JsonObject();
		data.addProperty("task", task);   // server maps name → task id via caTaskId() for auto-tick
		data.addProperty("tier", tier);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "ca");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "🏅 Combat achievement: " + task + (tier.isEmpty() ? "" : " (" + tier + ")"));
		ev.addProperty("key", "ca|" + task);   // task names are unique → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	// clueType is the tier (Beginner/Easy/Medium/Hard/Elite/Master); numberCompleted is the running
	// per-tier count from the message. The casket's GP value is owned by the separate `loot` slice.
	private void emitClue(String clueType, int numberCompleted)
	{
		final JsonObject data = new JsonObject();
		data.addProperty("clueType", clueType);
		data.addProperty("numberCompleted", numberCompleted);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "clue");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "🗺️ " + clueType + " clue completed (#" + numberCompleted + ")");
		ev.addProperty("key", "clue|" + clueType + "|" + numberCompleted);   // count rises each time → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	// Slot counts (completedEntries/totalEntries) and price aren't in the message, so they're null/0
	// to match the Dink data shape; the server's summary degrades gracefully without the counts.
	private void emitCollectionLog(String item)
	{
		final JsonObject data = new JsonObject();
		data.addProperty("itemName", item);
		data.add("completedEntries", JsonNull.INSTANCE);
		data.add("totalEntries", JsonNull.INSTANCE);
		data.addProperty("price", 0);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "clog");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "📒 New collection log: " + item);
		ev.addProperty("key", "clog|" + item);   // each item unlocks once → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	private void emitKillCount(String boss, int count)
	{
		final JsonObject data = new JsonObject();
		data.addProperty("boss", boss);
		data.addProperty("count", count);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "kc");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "⚔️ " + boss + " KC: " + String.format("%,d", count));
		ev.addProperty("key", "kc|" + boss + "|" + count);   // count rises each kill → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	// slayerCompleted/slayerPoints are sent as strings (matching the Dink data shape); points is
	// optional (Turael tasks award none). task degrades to "task" if the assignment was never seen.
	private void emitSlayer(String task, String count, String points)
	{
		final String taskName = (task == null || task.isEmpty()) ? "task" : task;
		final String completed = count == null ? null : count.replace(",", "");

		final JsonObject data = new JsonObject();
		data.addProperty("slayerTask", taskName);
		if (completed != null) { data.addProperty("slayerCompleted", completed); } else { data.add("slayerCompleted", JsonNull.INSTANCE); }
		if (points != null) { data.addProperty("slayerPoints", points.replace(",", "")); } else { data.add("slayerPoints", JsonNull.INSTANCE); }

		final String occurredAt = Instant.now().toString();
		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "slayer");
		ev.addProperty("occurredAt", occurredAt);
		ev.addProperty("summary", "💀 Slayer task complete: " + taskName + (completed != null ? " (" + completed + " done)" : ""));
		ev.addProperty("key", "slayer|" + occurredAt);   // tasks repeat → distinct moment, time-keyed
		ev.add("data", data);
		postEvent(ev);
	}

	// The pet drop is captured; the pet's identity isn't in the message, so petName/milestone stay
	// null (matching the Dink data shape). duplicate=true means a pet you already own.
	private void emitPet(boolean duplicate)
	{
		final JsonObject data = new JsonObject();
		data.add("petName", JsonNull.INSTANCE);
		data.addProperty("duplicate", duplicate);
		data.add("milestone", JsonNull.INSTANCE);

		final String occurredAt = Instant.now().toString();
		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "pet");
		ev.addProperty("occurredAt", occurredAt);
		ev.addProperty("summary", "🐾 Pet" + (duplicate ? " (duplicate)" : ""));
		ev.addProperty("key", "pet|" + occurredAt);   // each drop is a distinct moment → time-keyed
		ev.add("data", data);
		postEvent(ev);
	}

	private static String capitalize(String s)
	{
		if (s == null || s.isEmpty())
		{
			return s;
		}
		return Character.toUpperCase(s.charAt(0)) + s.substring(1).toLowerCase();
	}

	@Subscribe
	public void onNpcLootReceived(NpcLootReceived event)
	{
		final NPC npc = event.getNpc();
		handleLoot(npc != null && npc.getName() != null ? npc.getName() : "Loot", event.getItems());
	}

	@Subscribe
	public void onPlayerLootReceived(PlayerLootReceived event)
	{
		final Player player = event.getPlayer();
		handleLoot(player != null && player.getName() != null ? player.getName() : "Player", event.getItems());
	}

	@Subscribe
	public void onLootReceived(LootReceived event)
	{
		// NPC + PvP loot already arrive via the core events above; take only EVENT-type loot here
		// (clue caskets, barrows/raid chests, etc.) so a kill isn't recorded twice.
		if (event.getType() == LootRecordType.EVENT)
		{
			handleLoot(event.getName(), event.getItems());
		}
	}

	// Sum the GE value of a drop, build the item list, and emit a `loot` event if it clears the
	// configured min-value threshold (keeps trash off the timeline). Mirrors the Dink data shape.
	private void handleLoot(String source, Collection<ItemStack> items)
	{
		if (items == null || items.isEmpty())
		{
			return;
		}
		long total = 0;
		final JsonArray jsonItems = new JsonArray();
		final List<String> names = new ArrayList<>();
		for (ItemStack stack : items)
		{
			final int id = stack.getId();
			final int qty = stack.getQuantity();
			if (id < 0 || qty <= 0)
			{
				continue;
			}
			final int priceEach = itemManager.getItemPrice(id);
			total += (long) priceEach * qty;
			final String name = itemManager.getItemComposition(id).getName();

			final JsonObject it = new JsonObject();
			it.addProperty("name", name);
			it.addProperty("quantity", qty);
			it.addProperty("priceEach", priceEach);
			jsonItems.add(it);
			names.add(qty > 1 ? name + " x" + qty : name);
		}
		if (jsonItems.size() == 0)
		{
			return;
		}
		// ALL loot value feeds session GP/hr; the min-value threshold only gates the timeline event.
		if (sessionActive)
		{
			sessionLootValue += total;
		}
		if (total < config.lootMinValue())
		{
			return;
		}
		emitLoot(source == null || source.isEmpty() ? "Loot" : source, total, jsonItems, names);
	}

	private void emitLoot(String source, long value, JsonArray items, List<String> names)
	{
		final StringBuilder preview = new StringBuilder();
		for (int i = 0; i < Math.min(4, names.size()); i++)
		{
			preview.append(i == 0 ? "" : ", ").append(names.get(i));
		}
		if (names.size() > 4)
		{
			preview.append("…");
		}

		final JsonObject data = new JsonObject();
		data.addProperty("source", source);
		data.addProperty("value", value);
		data.add("items", items);
		data.add("category", JsonNull.INSTANCE);

		final String occurredAt = Instant.now().toString();
		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "loot");
		ev.addProperty("occurredAt", occurredAt);
		ev.addProperty("summary", "💰 " + source + ": " + String.format("%,d", value) + " gp"
			+ (preview.length() > 0 ? " (" + preview + ")" : ""));
		ev.addProperty("key", "loot|" + occurredAt);   // drops are frequent + distinct → time-keyed
		ev.add("data", data);
		postEvent(ev);
	}

	@Subscribe
	public void onItemContainerChanged(ItemContainerChanged event)
	{
		if (event.getContainerId() == InventoryID.INVENTORY.getId())
		{
			handleInventoryChange(event.getItemContainer());
			return;
		}
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

	// ── Resource gathering counter (ADR 0006 2B / D5) ─────────────────────────────
	// Diff the inventory vs the last snapshot; positive deltas are candidate gathers. Attribute them to
	// gathering only if a gathering-skill XP gain fired this tick (bidirectional: this catches the
	// "inventory before XP" order; the StatChanged handler catches "XP before inventory").
	private void handleInventoryChange(ItemContainer inventory)
	{
		if (inventory == null)
		{
			return;
		}
		if (!sessionActive || sessionPendingBaseline || !invSnapshotReady)
		{
			snapshotInventory(inventory);   // keep the snapshot current so we never count a backlog
			return;
		}
		final Map<Integer, Integer> now = countItems(inventory);
		final Map<Integer, Integer> gains = new HashMap<>();
		for (Map.Entry<Integer, Integer> e : now.entrySet())
		{
			final int delta = e.getValue() - invSnapshot.getOrDefault(e.getKey(), 0);
			if (delta > 0)
			{
				gains.put(e.getKey(), delta);
			}
		}
		invSnapshot.clear();
		invSnapshot.putAll(now);

		if (gains.isEmpty())
		{
			return;
		}
		if (tickGatherSkill != null)
		{
			attributeGathered(gains);   // XP already fired this tick
		}
		else
		{
			gains.forEach((id, q) -> tickInvGains.merge(id, q, Integer::sum));   // await XP this tick
		}
	}

	private void attributeGathered(Map<Integer, Integer> gains)
	{
		for (Map.Entry<Integer, Integer> e : gains.entrySet())
		{
			final int id = e.getKey();
			final int qty = e.getValue();
			sessionResources.merge(itemManager.getItemComposition(id).getName(), qty, Integer::sum);
			sessionGatheredValue += (long) itemManager.getItemPrice(id) * qty;
		}
	}

	private void snapshotInventory()
	{
		snapshotInventory(client.getItemContainer(InventoryID.INVENTORY));
	}

	private void snapshotInventory(ItemContainer inventory)
	{
		invSnapshot.clear();
		if (inventory != null)
		{
			invSnapshot.putAll(countItems(inventory));
		}
		invSnapshotReady = true;
	}

	private static Map<Integer, Integer> countItems(ItemContainer container)
	{
		final Map<Integer, Integer> counts = new HashMap<>();
		for (Item item : container.getItems())
		{
			final int id = item.getId();
			if (id >= 0 && item.getQuantity() > 0)
			{
				counts.merge(id, item.getQuantity(), Integer::sum);
			}
		}
		return counts;
	}

	// ── Play sessions (ADR 0006 Phase 2) ──────────────────────────────────────────
	private long idleThresholdMs()
	{
		return Math.max(1, config.sessionIdleMinutes()) * 60_000L;
	}

	private void startSession()
	{
		sessionActive = true;
		sessionPendingBaseline = true;
		sessionId = Instant.now().toString();
		sessionStartedAt = sessionId;
		startTotalXp = 0;
		currentTotalXp = 0;
		sessionActiveMs = 0;
		lastXpGainAt = 0;
		sessionPostTicks = 0;
		sessionStartXp.clear();
		sessionCurrentXp.clear();
		sessionLootValue = 0;
		invSnapshot.clear();
		invSnapshotReady = false;
		tickGatherSkill = null;
		tickInvGains.clear();
		sessionResources.clear();
		sessionGatheredValue = 0;
	}

	private void endSession()
	{
		postSession(true);     // final authoritative session row
		emitSessionRecap();    // one human-readable Timeline recap (ADR 0006 D6)
		sessionActive = false;
		sessionId = null;
	}

	// One timeline event summarising the session at logout (ADR 0006 D6). Skipped for empty sessions.
	private void emitSessionRecap()
	{
		if (sessionId == null)
		{
			return;
		}
		final long totalXp = Math.max(0, currentTotalXp - startTotalXp);
		if (totalXp <= 0)
		{
			return;
		}
		final long activeSeconds = sessionActiveMs / 1000L;
		final long gp = sessionLootValue + sessionGatheredValue;

		final JsonObject data = new JsonObject();
		data.addProperty("activeSeconds", activeSeconds);
		data.addProperty("totalXp", totalXp);
		data.addProperty("lootValue", sessionLootValue);
		data.addProperty("gatheredValue", sessionGatheredValue);

		final JsonObject ev = new JsonObject();
		ev.addProperty("type", "session");
		ev.addProperty("occurredAt", Instant.now().toString());
		ev.addProperty("summary", "🧭 Session: " + fmtDurationShort(activeSeconds) + " active · "
			+ fmtShort(totalXp) + " XP" + (gp > 0 ? " · " + fmtShort(gp) + " gp" : ""));
		ev.addProperty("key", "session|" + sessionId);   // one recap per session → idempotent
		ev.add("data", data);
		postEvent(ev);
	}

	private static String fmtShort(long n)
	{
		if (n >= 1_000_000_000L) return String.format("%.2fB", n / 1e9);
		if (n >= 1_000_000L) return String.format("%.2fM", n / 1e6);
		if (n >= 1_000L) return String.format("%.1fk", n / 1e3);
		return String.valueOf(n);
	}

	private static String fmtDurationShort(long secs)
	{
		final long h = secs / 3600, m = (secs % 3600) / 60;
		if (h > 0) return h + "h" + m + "m";
		if (m > 0) return m + "m";
		return secs + "s";
	}

	// Post the running session aggregate. Skips empty sessions (no XP gained) so we never store an
	// AFK/idle row. The server upserts by sessionId, so the live posts and the final post share a row.
	private void postSession(boolean finalPost)
	{
		if (sessionId == null)
		{
			return;
		}
		final long totalXp = Math.max(0, currentTotalXp - startTotalXp);
		if (totalXp <= 0)
		{
			return;
		}
		final JsonObject session = new JsonObject();
		session.addProperty("sessionId", sessionId);
		session.addProperty("startedAt", sessionStartedAt);
		if (finalPost)
		{
			session.addProperty("endedAt", Instant.now().toString());
		}
		else
		{
			session.add("endedAt", JsonNull.INSTANCE);
		}
		session.addProperty("activeSeconds", sessionActiveMs / 1000L);
		session.addProperty("totalXp", totalXp);

		// Per-skill XP gained this session (from the tracked maps, so it's valid even at logout).
		final JsonObject perSkill = new JsonObject();
		for (Map.Entry<Skill, Integer> e : sessionStartXp.entrySet())
		{
			final int gained = sessionCurrentXp.getOrDefault(e.getKey(), e.getValue()) - e.getValue();
			if (gained > 0)
			{
				perSkill.addProperty(e.getKey().getName(), gained);
			}
		}
		session.add("perSkill", perSkill.size() > 0 ? perSkill : JsonNull.INSTANCE);

		// Resources gathered + GE value, and loot value — both feed GP/hr server-side.
		final JsonObject resources = new JsonObject();
		for (Map.Entry<String, Integer> e : sessionResources.entrySet())
		{
			resources.addProperty(e.getKey(), e.getValue());
		}
		session.add("resources", resources.size() > 0 ? resources : JsonNull.INSTANCE);
		session.addProperty("gatheredValue", sessionGatheredValue);
		session.addProperty("lootValue", sessionLootValue);
		session.addProperty("final", finalPost);

		final JsonObject body = new JsonObject();
		body.addProperty("schema", "sessions/1");
		body.add("session", session);
		postJson("/api/sessions", body, "session");
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
