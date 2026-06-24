'use strict';

// Repository for the baseline character scan (ADR 0003). A scan is a full-state DUMP posted by the
// RuneLite plugin to POST /api/scan. Unlike the per-event /api/ingest path (which auto-ticks single
// quests/diaries/CAs), this reconciles whole SETS:
//
//   • first-sight (account has zero tracked state) → apply the dump wholesale (scan = truth).
//   • known character (any existing tracked state) → store the dump in scan_pending and surface a
//     diff; the user accepts (applyPending) or discards (clearPending) from the hub UI.
//
// Only sections PRESENT in the dump are written (partial dumps are valid — bank-only, clog-only…).
// Game-authoritative sets (quests FINISHED, diary tiers, CA completed) are full-replaced; unlocks are
// additive (the plugin only knows a derivable subset). Account-scoped throughout.

module.exports = function makeScan(db) {
  // ---- prepared statements ---------------------------------------------------
  const delQuests = db.prepare('DELETE FROM quest_completions WHERE account_id = ?');
  const insQuest  = db.prepare('INSERT OR IGNORE INTO quest_completions (account_id, quest) VALUES (?, ?)');
  const delQProg  = db.prepare('DELETE FROM quest_progress WHERE account_id = ?');
  const insQProg  = db.prepare("INSERT OR REPLACE INTO quest_progress (account_id, quest, status, updated_at) VALUES (?, ?, ?, datetime('now'))");
  const delDiary  = db.prepare('DELETE FROM diary_completions WHERE account_id = ?');
  const insDiary  = db.prepare('INSERT OR IGNORE INTO diary_completions (account_id, region, tier) VALUES (?, ?, ?)');
  const delCa     = db.prepare('DELETE FROM ca_completions WHERE account_id = ?');
  const insCa     = db.prepare('INSERT OR IGNORE INTO ca_completions (account_id, task_id) VALUES (?, ?)');
  const insUnlock = db.prepare('INSERT OR IGNORE INTO unlock_done (account_id, unlock) VALUES (?, ?)');
  const upStat    = db.prepare(`
    INSERT INTO profile_stats (account_id, key, value_num, value_str, updated_at)
    VALUES (@account_id, @key, @value_num, @value_str, datetime('now'))
    ON CONFLICT(account_id, key) DO UPDATE SET
      value_num = excluded.value_num, value_str = excluded.value_str, updated_at = excluded.updated_at`);
  const upClog    = db.prepare(`
    INSERT INTO collection_log_items (account_id, item_id, item_name, quantity, updated_at)
    VALUES (@account_id, @item_id, @item_name, @quantity, datetime('now'))
    ON CONFLICT(account_id, item_id) DO UPDATE SET
      item_name = excluded.item_name, quantity = excluded.quantity, updated_at = excluded.updated_at`);
  const upSkill   = db.prepare(`
    INSERT INTO skill_snapshots (account_id, date, skill, level, xp, rank)
    VALUES (@account_id, @date, @skill, @level, @xp, @rank)
    ON CONFLICT(account_id, date, skill) DO UPDATE SET
      level = excluded.level, xp = excluded.xp, rank = excluded.rank`);
  const upBank    = db.prepare(`
    INSERT INTO bank_snapshots (account_id, date, value, updated_at)
    VALUES (@account_id, @date, @value, datetime('now'))
    ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);

  const upPending  = db.prepare(`
    INSERT INTO scan_pending (account_id, payload, manifest_version, received_at)
    VALUES (@account_id, @payload, @manifest_version, datetime('now'))
    ON CONFLICT(account_id) DO UPDATE SET
      payload = excluded.payload, manifest_version = excluded.manifest_version, received_at = excluded.received_at`);
  const selPending = db.prepare('SELECT payload, manifest_version AS manifestVersion, received_at AS receivedAt FROM scan_pending WHERE account_id = ?');
  const delPending = db.prepare('DELETE FROM scan_pending WHERE account_id = ?');

  // ---- helpers ---------------------------------------------------------------
  const tableCount = (table, accountId) =>
    db.prepare('SELECT COUNT(*) AS c FROM ' + table + ' WHERE account_id = ?').get(accountId).c;

  // First-sight = the hub has never tracked any state for this account (ADR 0003 D2).
  const FIRST_SIGHT_TABLES = [
    'quest_completions', 'diary_completions', 'ca_completions', 'unlock_done',
    'quest_progress', 'collection_log_items', 'profile_stats', 'skill_snapshots',
  ];
  function isFirstSight(accountId) {
    return FIRST_SIGHT_TABLES.every(t => tableCount(t, accountId) === 0);
  }

  // Pull the dump's game-authoritative sets in a normalized shape (defensive parsing).
  function parseDump(dump) {
    const d = dump || {};
    const out = {};
    if (Array.isArray(d.skills)) {
      out.skills = d.skills
        .filter(s => s && typeof s.skill === 'string' && s.skill)
        .map(s => ({ skill: s.skill, level: int(s.level), xp: numOrNull(s.xp), rank: numOrNull(s.rank) }));
    }
    if (d.quests && typeof d.quests === 'object') {
      out.questsFinished = [];
      out.questsInProgress = [];
      for (const q in d.quests) {
        const st = String(d.quests[q] || '').toUpperCase();
        if (st === 'FINISHED') out.questsFinished.push(q);
        else if (st === 'IN_PROGRESS') out.questsInProgress.push(q);
      }
    }
    if (d.diaries && Array.isArray(d.diaries.tiers)) {
      out.diaries = d.diaries.tiers
        .filter(t => t && t.done && typeof t.region === 'string' && typeof t.tier === 'string')
        .map(t => ({ region: t.region, tier: t.tier }));
    }
    if (d.combatAchievements && Array.isArray(d.combatAchievements.completed)) {
      out.caCompleted = d.combatAchievements.completed.map(int).filter(Number.isInteger);
      out.caTotalPoints = numOrNull(d.combatAchievements.totalPoints);
    }
    if (Array.isArray(d.unlocks)) {
      out.unlocks = d.unlocks.filter(u => typeof u === 'string' && u);
    }
    if (d.stats && typeof d.stats === 'object') {
      out.stats = d.stats;
    }
    if (d.collectionLog && Array.isArray(d.collectionLog.items)) {
      out.clogItems = d.collectionLog.items
        .filter(it => it && Number.isInteger(int(it.id)))
        .map(it => ({ id: int(it.id), name: it.name == null ? null : String(it.name), quantity: Math.max(0, int(it.quantity) || 0) }));
    }
    if (d.bank && d.bank.value != null) {
      out.bank = Math.max(0, Math.round(Number(d.bank.value) || 0));
    }
    return out;
  }

  // Current state sets for diffing.
  function currentSets(accountId) {
    return {
      quests: new Set(db.prepare('SELECT quest FROM quest_completions WHERE account_id = ?').all(accountId).map(r => r.quest)),
      diaries: new Set(db.prepare('SELECT region, tier FROM diary_completions WHERE account_id = ?').all(accountId).map(r => r.region + '|' + r.tier)),
      ca: new Set(db.prepare('SELECT task_id FROM ca_completions WHERE account_id = ?').all(accountId).map(r => r.task_id)),
      unlocks: new Set(db.prepare('SELECT unlock FROM unlock_done WHERE account_id = ?').all(accountId).map(r => r.unlock)),
    };
  }
  function latestSkillLevel(accountId, skill) {
    const r = db.prepare('SELECT level FROM skill_snapshots WHERE account_id = ? AND skill = ? ORDER BY date DESC LIMIT 1').get(accountId, skill);
    return r ? r.level : null;
  }

  // Compute the human-facing diff (set adds/removes + skill level changes) for present sections.
  function buildDiff(accountId, dump) {
    const p = parseDump(dump);
    const cur = currentSets(accountId);
    const diff = {};
    if (p.questsFinished) {
      const want = new Set(p.questsFinished);
      diff.quests = { added: [...want].filter(q => !cur.quests.has(q)), removed: [...cur.quests].filter(q => !want.has(q)) };
    }
    if (p.diaries) {
      const want = new Set(p.diaries.map(d => d.region + '|' + d.tier));
      diff.diaries = {
        added: [...want].filter(k => !cur.diaries.has(k)).map(fromKey),
        removed: [...cur.diaries].filter(k => !want.has(k)).map(fromKey),
      };
    }
    if (p.caCompleted) {
      const want = new Set(p.caCompleted);
      diff.combatAchievements = { added: [...want].filter(i => !cur.ca.has(i)), removed: [...cur.ca].filter(i => !want.has(i)) };
    }
    if (p.unlocks) {
      const want = new Set(p.unlocks);
      diff.unlocks = { added: [...want].filter(u => !cur.unlocks.has(u)) };   // additive: removals not meaningful
    }
    if (p.skills) {
      const changed = [];
      for (const s of p.skills) {
        const from = latestSkillLevel(accountId, s.skill);
        if (from !== s.level) changed.push({ skill: s.skill, from, to: s.level });
      }
      if (changed.length) diff.skills = { changed };
    }
    return diff;
  }

  // Apply a dump (section-conditional). Returns per-section counts. `date` = YYYY-MM-DD for snapshots.
  const applyTx = db.transaction((accountId, p, date) => {
    const counts = {};
    if (p.skills) {
      for (const s of p.skills) upSkill.run({ account_id: accountId, date, skill: s.skill, level: s.level, xp: s.xp, rank: s.rank });
      counts.skills = p.skills.length;
    }
    if (p.questsFinished) {
      delQuests.run(accountId);                                   // full-replace (game-authoritative)
      for (const q of p.questsFinished) insQuest.run(accountId, q);
      counts.questsFinished = p.questsFinished.length;
    }
    if (p.questsInProgress) {
      delQProg.run(accountId);
      for (const q of p.questsInProgress) insQProg.run(accountId, q, 'IN_PROGRESS');
      counts.questsInProgress = p.questsInProgress.length;
    }
    if (p.diaries) {
      delDiary.run(accountId);
      for (const d of p.diaries) insDiary.run(accountId, d.region, d.tier);
      counts.diaries = p.diaries.length;
    }
    if (p.caCompleted) {
      delCa.run(accountId);
      for (const id of p.caCompleted) insCa.run(accountId, id);
      counts.caCompleted = p.caCompleted.length;
      if (p.caTotalPoints != null) upStat.run({ account_id: accountId, key: 'ca.totalPoints', value_num: p.caTotalPoints, value_str: null });
    }
    if (p.unlocks) {
      let n = 0;
      for (const u of p.unlocks) n += insUnlock.run(accountId, u).changes;   // additive
      counts.unlocksAdded = n;
    }
    if (p.stats) {
      let n = 0;
      for (const key in p.stats) {
        const v = p.stats[key];
        const isNum = typeof v === 'number' || typeof v === 'boolean';
        upStat.run({ account_id: accountId, key, value_num: isNum ? Math.round(Number(v)) : null, value_str: isNum ? null : (v == null ? null : String(v)) });
        n++;
      }
      counts.stats = n;
    }
    if (p.clogItems) {
      for (const it of p.clogItems) upClog.run({ account_id: accountId, item_id: it.id, item_name: it.name, quantity: it.quantity });
      counts.collectionLog = p.clogItems.length;
    }
    if (p.bank != null) {
      upBank.run({ account_id: accountId, date, value: p.bank });
      counts.bank = p.bank;
    }
    upStat.run({ account_id: accountId, key: 'scan.lastAppliedAt', value_num: null, value_str: new Date().toISOString() });
    return counts;
  });

  function applyDump(accountId, dump, date) {
    return applyTx(accountId, parseDump(dump), date);
  }

  // Orchestrator for POST /api/scan (ADR 0003 D2).
  function ingest(accountId, dump, date, manifestVersion) {
    if (isFirstSight(accountId)) {
      const applied = applyDump(accountId, dump, date);
      return { firstSight: true, applied };
    }
    upPending.run({ account_id: accountId, payload: JSON.stringify(dump || {}), manifest_version: manifestVersion == null ? null : int(manifestVersion) });
    return { firstSight: false, pending: true, diff: buildDiff(accountId, dump) };
  }

  // Hub UI: the stored pending dump's fresh diff (recomputed against current state), or null.
  function getPending(accountId) {
    const row = selPending.get(accountId);
    if (!row) return null;
    let dump = {};
    try { dump = JSON.parse(row.payload); } catch { /* corrupt — treat as empty */ }
    return { receivedAt: row.receivedAt, manifestVersion: row.manifestVersion, diff: buildDiff(accountId, dump) };
  }

  // Hub UI confirm: apply the stored pending dump, then clear it.
  function applyPending(accountId, date) {
    const row = selPending.get(accountId);
    if (!row) return { error: 'no pending scan' };
    let dump = {};
    try { dump = JSON.parse(row.payload); } catch { return { error: 'pending scan payload is corrupt' }; }
    const applied = applyDump(accountId, dump, date);
    delPending.run(accountId);
    return { applied };
  }

  function clearPending(accountId) {
    return { cleared: delPending.run(accountId).changes > 0 };
  }

  return { isFirstSight, buildDiff, applyDump, ingest, getPending, applyPending, clearPending };
};

// ---- small utils -------------------------------------------------------------
function int(v) { const n = parseInt(v, 10); return Number.isInteger(n) ? n : (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN); }
function numOrNull(v) { return v == null ? null : (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null); }
function fromKey(k) { const i = k.indexOf('|'); return { region: k.slice(0, i), tier: k.slice(i + 1) }; }
