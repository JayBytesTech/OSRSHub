If you're building this primarily for **your own account progression**, I'd focus less on being an OSRS wiki clone and more on being a **decision-making dashboard**. The best dashboards answer: *"What should I do next?"*

Some ideas by category:

## Progression Hub

### Account Overview

* Current combat level
* Total level
* Quest points
* Achievement diary completion %
* Collection log completion %
* Current bank value
* Time played
* Current goals

Example:

```
Account Status

Combat: 92
Total Level: 1743
Quest Points: 287/328
Bank Value: 143M
Diaries: 63%
Collection Log: 14%
```

---

## Goal System

This would probably be my #1 feature.

Instead of tracking stats, track:

### Active Goals

* Quest Cape
* Fire Cape
* Elite Void
* Achievement Diary Cape
* Base 70s
* Base 80s
* 100M Bank

Each goal breaks down automatically:

```
Quest Cape
├─ DT2 Complete
├─ WGS Complete
├─ 70 Smithing
└─ 65 Runecrafting
```

Clicking a goal should show all prerequisites.

---

## Account Efficiency Engine

This is where the dashboard becomes genuinely useful.

Ask:

### "What should I do right now?"

Based on:

* Current stats
* Quest progress
* GP available
* Gear owned

Generate suggestions:

```
Best Account Progression

1. Complete Underground Pass
2. Train Agility to 56
3. Unlock Barrows Gloves
4. Complete Medium Diaries
5. Train Slayer
```

---

## Money Maker Tracker

You're already doing this, but expand it.

Track:

### Historical GP

```
Zombie Pirates
Hours: 17
Profit: 22.4M
GP/hr: 1.32M

Vorkath
Hours: 31
Profit: 84M
GP/hr: 2.71M
```

Then graph:

* GP earned per activity
* Total account wealth over time
* Best GP/hr

Could be visualized with:

genui{"math_block_widget_always_prefetch_v2":{"content":"y=mx+b"}}

(Not for the equation itself, but trend charts showing account growth.)

---

## Unlock Tracker

One of the most useful OSRS features.

Track major unlocks:

### PvM Unlocks

* Dragon Defender
* Fire Cape
* Fighter Torso
* Void
* Elite Void
* Ava's Assembler
* Quest Cape

### Transportation

* Fairy Rings
* Spirit Trees
* POH Portal Nexus
* Achievement Diary teleports

### Account Unlocks

* Herb Sack
* Rune Pouch
* Seed Box
* Gem Bag

Display as a progression tree.

---

## Gear Progression

Show:

### Owned

* Current gear

### Recommended Next Upgrade

```
Current:
Dragon Crossbow

Suggested:
Bowfa

Cost:
118M

Progress:
43M / 118M
```

---

## Boss Dashboard

Track:

### Per Boss

* KC
* Personal Best
* Collection log items
* GP earned
* Death count

Example:

```
Vorkath

KC: 843
PB: 1:09
Profit: 228M
Deaths: 34
Log: 5/7
```

---

## Collection Log Tracker

This could become one of the coolest pages.

Show:

### Completion %

For:

* Bosses
* Clues
* Raids
* Minigames

Display missing items only.

---

## Achievement Diary Planner

Input current diary status.

Show:

```
Lumbridge Elite

Remaining:
- 76 Runecrafting
- Quest Cape
- Smithing outfit
```

Same for every region.

---

## Quest Dependency Graph

One feature I rarely see done well.

Show:

```
Song of the Elves
├─ Mourning's End II
├─ Roving Elves
├─ 70 Agility
├─ 70 Herblore
├─ 70 Smithing
├─ 70 Construction
├─ 70 Farming
└─ 70 Hunter
```

Then recursively expand prerequisites.

---

## XP Planning

For each skill:

```
Fishing

Current: 72
Goal: 91

XP Remaining: 5.3M

Barbarian Fishing:
72 hours

Tempoross:
95 hours
```

---

## Daily / Weekly Checklist

Huge quality-of-life feature.

### Daily

* Battlestaves
* Herb runs
* Birdhouses
* Kingdom

### Weekly

* Tears of Guthix
* Miscellaneous rewards
* Penguin points (if applicable)

Auto-reset timer.

---

## RuneLite Integration

If you're comfortable with APIs/plugins:

Track:

* Bank value history
* XP gains
* Session statistics
* Boss kills
* Clue completions

This turns the dashboard into a living account history.

---

## "Account Value" Score

Create your own metric:

```
Account Progress Score

Skills: 45%
Quests: 20%
Diaries: 15%
Collection Log: 10%
Combat Achievements: 10%

Overall:
67.4%
```

Watching this climb over months would be incredibly satisfying.

---

If I were building an OSRS hub from scratch, my top 5 pages would be:

1. **Dashboard/Home** (everything important at a glance)
2. **Goals & Roadmap** (automatic prerequisite tracking)
3. **Money Maker Analytics**
4. **Boss & Collection Log Tracker**
5. **Account Optimizer** ("What should I do next?")

That last one is what would make the site feel unique rather than just a progress tracker. It becomes a personal OSRS assistant instead of a spreadsheet.


Absolutely — this is where the hub gets awesome.

A RuneLite plugin could automatically track:

## Very reliable to auto-track

### Skills / XP

* Current XP per skill
* Level changes
* XP gained per session
* XP/hr
* Time to target level
* Best training sessions

RuneLite exposes stat changes through `StatChanged`, which fires when XP, level, or boosted level changes. ([Runelite Static][1])

### Inventory / bank / equipment changes

* Bank value snapshots
* Inventory value
* Gear owned
* Loot gained
* Supplies used
* GP stack changes
* Item acquisition history

RuneLite has `ItemContainerChanged`, which fires when stack sizes change, including banking, looting, withdrawing, and dropping items. ([Runelite Static][2])

### Grand Exchange activity

* Buy/sell offers
* Completed trades
* Flipping profit
* Item price history
* Total spent / earned

RuneLite has a `GrandExchangeOfferChanged` event for GE offer updates. ([Runelite Static][3])

### Sessions

* Login/logout time
* Total time played through plugin
* AFK time
* Active time
* Session profit
* Session XP
* Session deaths
* Session boss KC

`GameStateChanged` and `GameTick` are useful here; RuneLite’s `GameTick` fires every game tick, around 0.6 seconds. ([Runelite Static][3]) ([Runelite Static][4])

## Great dashboard features

### Quest + diary progress

You can track:

* Quest completions
* Diary completions
* Varbit-based unlocks
* Prerequisite status
* “What quests did I unlock today?”

This would likely use varbits/varplayers via `VarbitChanged`.

### Bossing / PvM

Track:

* Boss KC
* Loot per boss
* Deaths
* PBs if chat message appears
* Supplies used per trip
* Profit per trip
* Average kill value
* Collection log drops

### Slayer

* Current task
* Task streak
* Points
* Slayer XP/hr
* Loot per task
* Block/skip history
* Best tasks by GP/hr and XP/hr

### Clues

* Clue completions
* Casket loot
* Average clue value
* Unique rewards
* Steps completed
* Clue type stats

### Farming / birdhouse / dailies

* Herb run profit
* Seeds planted
* Harvest yield
* Birdhouse run value
* Tree run reminders
* Kingdom collection history
* Battlestaff purchases

### Collection log

Track:

* New collection log slots
* Missing items
* Drops by source
* Boss log completion
* Clue log completion
* Minigame log completion

## The killer feature

### “Account timeline”

A living feed like:

```text
Today
+ Level 61 Slayer
+ Completed Monkey Madness I
+ Bank value +3.8M
+ New drop: Black mask
+ 142k Strength XP
+ 1.1M GP from Slayer
```

That would make the hub feel personal instead of just statistical.

## Best MVP plugin data to send to your site

Start with:

```text
account_id
timestamp
skill_xp
inventory_snapshot
equipment_snapshot
bank_snapshot
quest_varbits
ge_offers
chat_events
boss_kc
loot_events
location
session_id
```

Then your web app can derive:

* XP graphs
* net worth graphs
* goal progress
* loot history
* money maker analytics
* “what changed since last login”
* recommended next goals

The only thing I’d be careful with: don’t try to automate gameplay or interact with the game client beyond reading state/events. Keep it passive telemetry + dashboard syncing.

[1]: https://static.runelite.net/runelite-api/apidocs/net/runelite/api/events/StatChanged.html?utm_source=chatgpt.com "StatChanged (RuneLite API 1.12.27 API)"
[2]: https://static.runelite.net/runelite-api/apidocs/net/runelite/api/events/ItemContainerChanged.html?is-external=true&utm_source=chatgpt.com "ItemContainerChanged (RuneLite API 1.12.26.3 API)"
[3]: https://static.runelite.net/runelite-api/apidocs/net/runelite/api/events/package-summary.html?utm_source=chatgpt.com "Package net.runelite.api.events"
[4]: https://static.runelite.net/runelite-api/apidocs/net/runelite/api/events/GameTick.html?utm_source=chatgpt.com "GameTick (RuneLite API 1.12.26.3 API)"
