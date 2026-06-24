'use strict';

// Repository for xp_sessions — play-session aggregates feeding XP/hr & GP/hr (ADR 0006, Phase 2).
// The plugin upserts a session row by session_id (periodic updates while playing + a final post on
// logout). Rates are derived on read so they stay correct as a live session grows. Account-scoped.

module.exports = function makeSessions(db) {
  const upsertStmt = db.prepare(`
    INSERT INTO xp_sessions
      (account_id, session_id, started_at, ended_at, active_seconds, total_xp,
       loot_value, gathered_value, per_skill_json, resources_json, final, updated_at)
    VALUES
      (@account_id, @session_id, @started_at, @ended_at, @active_seconds, @total_xp,
       @loot_value, @gathered_value, @per_skill_json, @resources_json, @final, datetime('now'))
    ON CONFLICT(account_id, session_id) DO UPDATE SET
      ended_at       = excluded.ended_at,
      active_seconds = excluded.active_seconds,
      total_xp       = excluded.total_xp,
      loot_value     = excluded.loot_value,
      gathered_value = excluded.gathered_value,
      per_skill_json = excluded.per_skill_json,
      resources_json = excluded.resources_json,
      final          = excluded.final,
      updated_at     = excluded.updated_at
  `);

  const intOr0 = (v) => Math.max(0, Math.round(Number(v) || 0));
  const jsonOrNull = (o) => (o && typeof o === 'object' ? JSON.stringify(o) : null);

  // A non-final session is only "live" if it was updated recently — the plugin posts ~every 60s, so a
  // session whose updates stopped (client closed/crashed without a logout) goes stale instead of
  // masquerading as live forever. SQLite stores updated_at as UTC 'YYYY-MM-DD HH:MM:SS'.
  const LIVE_WINDOW_MS = 10 * 60 * 1000;
  const isFresh = (updatedAt) => {
    const t = Date.parse(String(updatedAt).replace(' ', 'T') + 'Z');
    return Number.isFinite(t) && (Date.now() - t) < LIVE_WINDOW_MS;
  };

  // Upsert a session aggregate. `s` is the plugin's session object (camelCase). Returns the stored row
  // (derived rates included). Throws only on programmer error; callers validate sessionId/startedAt.
  function upsert(accountId, s) {
    upsertStmt.run({
      account_id: accountId,
      session_id: String(s.sessionId),
      started_at: String(s.startedAt),
      ended_at: s.endedAt ? String(s.endedAt) : null,
      active_seconds: intOr0(s.activeSeconds),
      total_xp: intOr0(s.totalXp),
      loot_value: intOr0(s.lootValue),
      gathered_value: intOr0(s.gatheredValue),
      per_skill_json: jsonOrNull(s.perSkill),
      resources_json: jsonOrNull(s.resources),
      final: s.final ? 1 : 0,
    });
    return get(accountId, String(s.sessionId));
  }

  function shape(row) {
    if (!row) return null;
    const activeHours = row.active_seconds > 0 ? row.active_seconds / 3600 : 0;
    const gpTotal = row.loot_value + row.gathered_value;
    return {
      sessionId: row.session_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      activeSeconds: row.active_seconds,
      totalXp: row.total_xp,
      lootValue: row.loot_value,
      gatheredValue: row.gathered_value,
      perSkill: row.per_skill_json ? JSON.parse(row.per_skill_json) : null,
      resources: row.resources_json ? JSON.parse(row.resources_json) : null,
      final: !!row.final,
      live: !row.final && isFresh(row.updated_at),   // ongoing AND still posting
      // Derived rates (null when there's no active time yet, to avoid div-by-zero / misleading 0).
      xpPerHour: activeHours > 0 ? Math.round(row.total_xp / activeHours) : null,
      gpPerHour: activeHours > 0 ? Math.round(gpTotal / activeHours) : null,
    };
  }

  function get(accountId, sessionId) {
    return shape(db.prepare(
      'SELECT * FROM xp_sessions WHERE account_id = ? AND session_id = ?'
    ).get(accountId, sessionId));
  }

  function recent(accountId, limit = 30) {
    return db.prepare(
      'SELECT * FROM xp_sessions WHERE account_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(accountId, limit).map(shape);
  }

  // The live/most-recent ongoing session — not final AND still being posted to (a stale, never-ended
  // session from a crash/close is excluded so the dashboard doesn't show a phantom live session).
  function current(accountId) {
    return shape(db.prepare(
      "SELECT * FROM xp_sessions WHERE account_id = ? AND final = 0" +
      " AND updated_at >= datetime('now', '-10 minutes') ORDER BY started_at DESC LIMIT 1"
    ).get(accountId));
  }

  function count(accountId) {
    return db.prepare('SELECT COUNT(*) AS c FROM xp_sessions WHERE account_id = ?').get(accountId).c;
  }

  return { upsert, get, recent, current, count };
};
