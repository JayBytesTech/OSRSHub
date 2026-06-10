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

  return { addEvent, recent, count };
};
