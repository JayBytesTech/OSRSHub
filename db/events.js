'use strict';

// Repository for account_events (the passive telemetry feed → Account Timeline).
// Factory: pass the better-sqlite3 handle, get back the repo. Append-only; writes are
// idempotent via dedupe_key so a re-posted webhook doesn't create duplicate rows.

module.exports = function makeEvents(db) {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO account_events
      (account_id, type, occurred_at, summary, data, source, dedupe_key)
    VALUES (@account_id, @type, @occurred_at, @summary, @data, @source, @dedupe_key)
  `);

  // e: { type, occurred_at, summary, data?, source?, dedupe_key? }. `data` may be an
  // object (serialized here) or a string (stored as-is). Returns true if a row was inserted.
  function addEvent(accountId, e) {
    const data = e.data == null ? null : (typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
    const info = ins.run({
      account_id: accountId,
      type: e.type || 'other',
      occurred_at: e.occurred_at || new Date().toISOString(),
      summary: e.summary || '',
      data,
      source: e.source || 'dink',
      dedupe_key: e.dedupe_key || null,
    });
    return info.changes > 0;
  }

  // Most recent events first. `data` is parsed back into an object (null on failure).
  function recent(accountId, limit = 50) {
    const rows = db.prepare(
      'SELECT id, type, occurred_at, summary, data, source FROM account_events WHERE account_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?'
    ).all(accountId, limit);
    return rows.map(r => {
      let data = null;
      if (r.data) { try { data = JSON.parse(r.data); } catch { data = null; } }
      return { ...r, data };
    });
  }

  function count(accountId) {
    return db.prepare('SELECT COUNT(*) AS c FROM account_events WHERE account_id = ?').get(accountId).c;
  }

  // Aggregate the loot feed (+ true KC from kill_count events) for the Loot & Wealth view.
  // All computation is in JS over the account's loot/kc rows — personal scale.
  function lootSummary(accountId) {
    const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
    const lootRows = db.prepare(
      "SELECT occurred_at, summary, data FROM account_events WHERE account_id = ? AND type = 'loot' ORDER BY occurred_at"
    ).all(accountId).map(r => ({ occurred_at: r.occurred_at, summary: r.summary, data: parse(r.data) }));
    const kcRows = db.prepare(
      "SELECT data FROM account_events WHERE account_id = ? AND type = 'kc'"
    ).all(accountId).map(r => parse(r.data));

    // Latest (max) KC per boss — kill counts only ever climb.
    const kcByBoss = {};
    for (const k of kcRows) {
      if (!k || !k.boss || k.count == null) continue;
      kcByBoss[k.boss] = Math.max(kcByBoss[k.boss] || 0, Number(k.count) || 0);
    }

    let totalValue = 0;
    const sources = {};
    for (const row of lootRows) {
      const src = (row.data && row.data.source) || 'Unknown';
      const val = Number(row.data && row.data.value) || 0;
      totalValue += val;
      const s = sources[src] || (sources[src] = { source: src, dropCount: 0, totalValue: 0, biggest: 0 });
      s.dropCount++;
      s.totalValue += val;
      if (val > s.biggest) s.biggest = val;
    }
    const bySource = Object.values(sources)
      .map(s => ({ ...s, kc: kcByBoss[s.source] != null ? kcByBoss[s.source] : null }))
      .sort((a, b) => b.totalValue - a.totalValue);

    const biggestDrops = lootRows
      .map(r => ({ summary: r.summary, occurred_at: r.occurred_at, value: Number(r.data && r.data.value) || 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Daily cumulative wealth-from-drops series.
    const perDay = {};
    for (const row of lootRows) {
      const day = String(row.occurred_at).slice(0, 10);
      perDay[day] = (perDay[day] || 0) + (Number(row.data && row.data.value) || 0);
    }
    const dates = Object.keys(perDay).sort();
    let running = 0;
    const cumulative = dates.map(d => (running += perDay[d]));

    return { totalValue, dropCount: lootRows.length, bySource, biggestDrops, wealth: { dates, cumulative } };
  }

  // Progression milestones from the typed telemetry feed (collection log, clues, combat
  // achievements, pets, deaths). Dink sends running totals, so we take the latest/max value
  // for cumulative figures rather than counting rows. All JS over the account's rows.
  function milestonesSummary(accountId) {
    const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
    const rowsOf = (type) => db.prepare(
      "SELECT occurred_at, summary, data FROM account_events WHERE account_id = ? AND type = ? ORDER BY occurred_at"
    ).all(accountId, type).map(r => ({ occurred_at: r.occurred_at, summary: r.summary, data: parse(r.data) }));

    // Collection log: the most recent event carries the current completed/total slots.
    let clog = { completed: null, total: null, pct: null, lastItem: null };
    for (const r of rowsOf('clog')) {
      const c = Number(r.data.completedEntries), t = Number(r.data.totalEntries);
      if (Number.isFinite(c)) clog.completed = c;
      if (Number.isFinite(t)) clog.total = t;
      if (r.data.itemName) clog.lastItem = r.data.itemName;
    }
    if (clog.completed != null && clog.total) clog.pct = Math.round((clog.completed / clog.total) * 100);

    // Clues: max numberCompleted per tier (running count); fall back to row count if absent.
    const clues = {}, clueSeen = {};
    for (const r of rowsOf('clue')) {
      const tier = r.data.clueType || 'Clue';
      clueSeen[tier] = (clueSeen[tier] || 0) + 1;
      const n = Number(r.data.numberCompleted);
      if (Number.isFinite(n)) clues[tier] = Math.max(clues[tier] || 0, n);
    }
    for (const tier in clueSeen) if (clues[tier] == null) clues[tier] = clueSeen[tier];

    // Combat achievements: latest running totalPoints.
    let caPoints = null;
    for (const r of rowsOf('ca')) { const p = Number(r.data.totalPoints); if (Number.isFinite(p)) caPoints = p; }

    // Pets: count non-duplicate obtains + names.
    const petNames = [];
    for (const r of rowsOf('pet')) { if (!r.data.duplicate && r.data.petName) petNames.push(r.data.petName); }

    // Deaths: count + total value lost.
    const deathRows = rowsOf('death');
    const valueLost = deathRows.reduce((s, r) => s + (Number(r.data.valueLost) || 0), 0);

    return {
      clog,
      clues,
      ca: { points: caPoints },
      pets: { count: petNames.length, names: petNames.slice(-12) },
      deaths: { count: deathRows.length, valueLost },
    };
  }

  return { addEvent, recent, count, lootSummary, milestonesSummary };
};
