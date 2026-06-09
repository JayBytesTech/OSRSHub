'use strict';

// Repository for the durable app state that used to live in the vault "state" note:
// quest completions + skill goals. Account-scoped. Full-replace semantics on write,
// matching the previous "rewrite the whole note" behavior the frontend relies on.

module.exports = function makeState(db) {
  const insQuest = db.prepare('INSERT OR REPLACE INTO quest_completions (account_id, quest) VALUES (?, ?)');
  const insGoal  = db.prepare('INSERT OR REPLACE INTO goals (account_id, skill, target) VALUES (?, ?, ?)');
  const delQuests = db.prepare('DELETE FROM quest_completions WHERE account_id = ?');
  const delGoals  = db.prepare('DELETE FROM goals WHERE account_id = ?');

  function getState(accountId) {
    const completed = {};
    for (const r of db.prepare('SELECT quest FROM quest_completions WHERE account_id = ?').all(accountId)) {
      completed[r.quest] = true;
    }
    const goals = db.prepare('SELECT skill, target FROM goals WHERE account_id = ? ORDER BY skill').all(accountId);
    return { completed, goals };
  }

  // Replace this account's entire state in one transaction. Returns inserted counts.
  const replaceTx = db.transaction((accountId, completed, goals) => {
    delQuests.run(accountId);
    delGoals.run(accountId);
    let quests = 0, goalCount = 0;
    for (const quest in (completed || {})) {
      if (!completed[quest]) continue;            // only store truthy completions
      insQuest.run(accountId, quest);
      quests++;
    }
    for (const g of (Array.isArray(goals) ? goals : [])) {
      if (!g || typeof g.skill !== 'string' || !g.skill) continue;
      const target = parseInt(g.target, 10);
      if (!Number.isInteger(target)) continue;
      insGoal.run(accountId, g.skill, target);
      goalCount++;
    }
    return { quests, goals: goalCount };
  });

  function setState(accountId, payload) {
    const body = payload || {};
    return replaceTx(accountId, body.completed || {}, body.goals || []);
  }

  function count(accountId) {
    const q = db.prepare('SELECT COUNT(*) AS c FROM quest_completions WHERE account_id = ?').get(accountId).c;
    const g = db.prepare('SELECT COUNT(*) AS c FROM goals WHERE account_id = ?').get(accountId).c;
    return q + g;
  }

  // One-time seed from the old vault state markdown (the ```json block).
  function importFromVaultMarkdown(accountId, mdText) {
    const m = mdText.match(/```json\s*([\s\S]*?)```/);
    if (!m) return { quests: 0, goals: 0 };
    let data;
    try { data = JSON.parse(m[1]); } catch { return { quests: 0, goals: 0 }; }
    return replaceTx(accountId, data.completed || {}, Array.isArray(data.goals) ? data.goals : []);
  }

  return { getState, setState, count, importFromVaultMarkdown };
};
