'use strict';

// Repository for bank_snapshots — the daily bank-value trend fed by the custom RuneLite plugin
// (F3.2). Bank value is a running quantity, so this mirrors db/accountValue.js: one point per day,
// latest reading of the day wins.

module.exports = function makeBank(db) {
  const upsert = db.prepare(`
    INSERT INTO bank_snapshots (account_id, date, value, updated_at)
    VALUES (@account_id, @date, @value, datetime('now'))
    ON CONFLICT(account_id, date) DO UPDATE SET
      value = excluded.value, updated_at = excluded.updated_at
  `);

  function record(accountId, date, value) {
    upsert.run({ account_id: accountId, date, value: Math.max(0, Math.round(Number(value) || 0)) });
  }

  function getTrend(accountId) {
    const rows = db.prepare(
      'SELECT date, value FROM bank_snapshots WHERE account_id = ? ORDER BY date'
    ).all(accountId);
    return { dates: rows.map(r => r.date), value: rows.map(r => r.value) };
  }

  function latest(accountId) {
    const r = db.prepare(
      'SELECT date, value FROM bank_snapshots WHERE account_id = ? ORDER BY date DESC LIMIT 1'
    ).get(accountId);
    return r || null;
  }

  function count(accountId) {
    return db.prepare('SELECT COUNT(*) AS c FROM bank_snapshots WHERE account_id = ?').get(accountId).c;
  }

  return { record, getTrend, latest, count };
};
