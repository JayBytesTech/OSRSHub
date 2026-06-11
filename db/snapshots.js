'use strict';

// Repository for skill_snapshots (the daily Hiscores history).
// Factory: pass the better-sqlite3 handle, get back the repo. Keyed by skill name,
// so there is no positional coupling with any SKILL_NAMES ordering.

module.exports = function makeSnapshots(db) {
  const upsert = db.prepare(`
    INSERT INTO skill_snapshots (account_id, date, skill, level, xp, rank)
    VALUES (@account_id, @date, @skill, @level, @xp, @rank)
    ON CONFLICT(account_id, date, skill) DO UPDATE SET
      level = excluded.level, xp = excluded.xp, rank = excluded.rank
  `);

  // statsByName: { <skill>: [rank, level, xp], ... } (the shape from fetchHiscores()).
  // "Overall" is skipped — Total is derived on read.
  const recordTx = db.transaction((accountId, date, statsByName) => {
    for (const skill in statsByName) {
      if (skill === 'Overall') continue;
      const v = statsByName[skill];
      if (!Array.isArray(v)) continue;
      upsert.run({ account_id: accountId, date, skill, level: v[1], xp: v[2] ?? null, rank: v[0] ?? null });
    }
  });
  function recordSnapshot(accountId, date, statsByName) {
    recordTx(accountId, date, statsByName);
  }

  function count(accountId) {
    return db.prepare('SELECT COUNT(*) AS c FROM skill_snapshots WHERE account_id = ?').get(accountId).c;
  }

  // Rebuilds the response shape: { dates:[...], skills:{ <name>:[level/date...], Total:[...] },
  // xp:{ <name>:[xp/date...], Total:[...] } }. Levels carry the last known value forward across
  // dates a skill is missing (mirrors prior behavior). XP is null before a skill's first real XP
  // reading (the legacy vault import stored no XP), then carries forward — so the XP line breaks
  // rather than drawing a fake floor for the pre-tracking period.
  function getHistory(accountId) {
    const dates = db.prepare(
      'SELECT DISTINCT date FROM skill_snapshots WHERE account_id = ? ORDER BY date'
    ).all(accountId).map(r => r.date);

    const rows = db.prepare(
      'SELECT date, skill, level, xp FROM skill_snapshots WHERE account_id = ?'
    ).all(accountId);

    const bySkill = {};   // level by date
    const xpBy = {};      // xp by date (only where recorded)
    const xpDates = new Set();
    for (const r of rows) {
      (bySkill[r.skill] || (bySkill[r.skill] = {}))[r.date] = r.level;
      if (r.xp != null) { (xpBy[r.skill] || (xpBy[r.skill] = {}))[r.date] = r.xp; xpDates.add(r.date); }
    }

    const skills = {};
    for (const skill in bySkill) {
      const series = [];
      let last = null;
      for (const d of dates) {
        if (bySkill[skill][d] != null) last = bySkill[skill][d];
        series.push(last != null ? last : 1);
      }
      skills[skill] = series;
    }
    skills.Total = dates.map((_, i) => {
      let sum = 0;
      for (const skill in skills) if (skill !== 'Total') sum += skills[skill][i] || 0;
      return sum;
    });

    // XP series: null until a skill's first recorded XP, then carry forward.
    const xp = {};
    for (const skill in bySkill) {
      const series = [];
      let last = null, started = false;
      for (const d of dates) {
        if (xpBy[skill] && xpBy[skill][d] != null) { last = xpBy[skill][d]; started = true; }
        series.push(started ? last : null);
      }
      xp[skill] = series;
    }
    // Total XP: null until XP tracking begins on any skill, then sum carried-forward XP.
    let totalStarted = false;
    xp.Total = dates.map((d, i) => {
      if (xpDates.has(d)) totalStarted = true;
      if (!totalStarted) return null;
      let sum = 0;
      for (const skill in xp) if (skill !== 'Total') sum += xp[skill][i] || 0;
      return sum;
    });

    return { dates, skills, xp };
  }

  // One-time seed from the old vault history markdown (the ```json block).
  // Returns the number of (date, skill) rows inserted.
  function importFromVaultMarkdown(accountId, mdText) {
    const m = mdText.match(/```json\s*([\s\S]*?)```/);
    if (!m) return 0;
    let data;
    try { data = JSON.parse(m[1]); } catch { return 0; }
    const dates = Array.isArray(data.dates) ? data.dates : [];
    const skills = data.skills || {};
    let n = 0;
    const tx = db.transaction(() => {
      for (const skill in skills) {
        if (skill === 'Total' || skill === 'Overall') continue;
        const arr = skills[skill];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < dates.length && i < arr.length; i++) {
          if (arr[i] == null) continue;
          upsert.run({ account_id: accountId, date: dates[i], skill, level: arr[i], xp: null, rank: null });
          n++;
        }
      }
    });
    tx();
    return n;
  }

  return { recordSnapshot, count, getHistory, importFromVaultMarkdown };
};
