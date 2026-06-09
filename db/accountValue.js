'use strict';

// Repository for the daily Account Value score (the trend series). The score itself is
// computed client-side (it needs frontend-only quest metadata); this just stores points.

module.exports = function makeAccountValue(db) {
  const upsert = db.prepare(`
    INSERT INTO account_value_snapshots (account_id, date, score, skills_pct, quests_pct)
    VALUES (@account_id, @date, @score, @skills_pct, @quests_pct)
    ON CONFLICT(account_id, date) DO UPDATE SET
      score = excluded.score, skills_pct = excluded.skills_pct, quests_pct = excluded.quests_pct
  `);

  function record(accountId, date, { score, skillsPct, questsPct }) {
    upsert.run({
      account_id: accountId,
      date,
      score: Number(score),
      skills_pct: skillsPct == null ? null : Number(skillsPct),
      quests_pct: questsPct == null ? null : Number(questsPct),
    });
  }

  function getTrend(accountId) {
    const rows = db.prepare(
      'SELECT date, score, skills_pct, quests_pct FROM account_value_snapshots WHERE account_id = ? ORDER BY date'
    ).all(accountId);
    return {
      dates:  rows.map(r => r.date),
      score:  rows.map(r => r.score),
      skills: rows.map(r => r.skills_pct),
      quests: rows.map(r => r.quests_pct),
    };
  }

  function count(accountId) {
    return db.prepare('SELECT COUNT(*) AS c FROM account_value_snapshots WHERE account_id = ?').get(accountId).c;
  }

  return { record, getTrend, count };
};
