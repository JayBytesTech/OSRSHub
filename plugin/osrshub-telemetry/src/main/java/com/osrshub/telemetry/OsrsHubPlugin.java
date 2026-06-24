package com.osrshub.telemetry;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.inject.Provides;
import java.io.IOException;
import java.time.Instant;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
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
 *   • diaries     → POST /api/events (ADR 0005 Phase 1)
 *   • combat achs → POST /api/events (ADR 0005 Phase 1)
 *   • clues       → POST /api/events (ADR 0005 Phase 1)
 *   • pets        → POST /api/events (ADR 0005 Phase 1)
 *   • slayer      → POST /api/events (ADR 0005 Phase 1)
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

	// Current Slayer task name, learned from the assignment chat line and reported on completion.
	private String currentSlayerTask = null;

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
