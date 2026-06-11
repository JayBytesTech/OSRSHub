'use strict';

// Repository for the durable app state that used to live in the vault "state" note:
// quest completions + skill goals. Account-scoped. Full-replace semantics on write,
// matching the previous "rewrite the whole note" behavior the frontend relies on.

module.exports = function makeState(db) {
  const insQuest = db.prepare('INSERT OR REPLACE INTO quest_completions (account_id, quest) VALUES (?, ?)');
  const insGoal  = db.prepare('INSERT OR REPLACE INTO goals (account_id, skill, target) VALUES (?, ?, ?)');
  const insQGoal = db.prepare('INSERT OR REPLACE INTO quest_goals (account_id, quest) VALUES (?, ?)');
  const insPGoal = db.prepare('INSERT OR REPLACE INTO preset_goals (account_id, kind) VALUES (?, ?)');
  const insDiary = db.prepare('INSERT OR REPLACE INTO diary_completions (account_id, region, tier) VALUES (?, ?, ?)');
  const insDiaryTask = db.prepare('INSERT OR REPLACE INTO diary_task_completions (account_id, task_id) VALUES (?, ?)');
  const delQuests = db.prepare('DELETE FROM quest_completions WHERE account_id = ?');
  const delGoals  = db.prepare('DELETE FROM goals WHERE account_id = ?');
  const delQGoals = db.prepare('DELETE FROM quest_goals WHERE account_id = ?');
  const delPGoals = db.prepare('DELETE FROM preset_goals WHERE account_id = ?');
  const delDiaries = db.prepare('DELETE FROM diary_completions WHERE account_id = ?');
  const delDiaryTasks = db.prepare('DELETE FROM diary_task_completions WHERE account_id = ?');

  function getState(accountId) {
    const completed = {};
    for (const r of db.prepare('SELECT quest FROM quest_completions WHERE account_id = ?').all(accountId)) {
      completed[r.quest] = true;
    }
    const goals = db.prepare('SELECT skill, target FROM goals WHERE account_id = ? ORDER BY skill').all(accountId);
    const questGoals = db.prepare('SELECT quest FROM quest_goals WHERE account_id = ? ORDER BY quest').all(accountId).map(r => r.quest);
    const presetGoals = db.prepare('SELECT kind FROM preset_goals WHERE account_id = ? ORDER BY kind').all(accountId).map(r => r.kind);
    const diaries = db.prepare('SELECT region, tier FROM diary_completions WHERE account_id = ? ORDER BY region, tier').all(accountId);
    const diaryTasks = db.prepare('SELECT task_id FROM diary_task_completions WHERE account_id = ? ORDER BY task_id').all(accountId).map(r => r.task_id);
    return { completed, goals, questGoals, presetGoals, diaries, diaryTasks };
  }

  // Replace this account's entire state in one transaction. Returns inserted counts.
  const replaceTx = db.transaction((accountId, completed, goals, questGoals, presetGoals, diaries, diaryTasks) => {
    delQuests.run(accountId);
    delGoals.run(accountId);
    delQGoals.run(accountId);
    delPGoals.run(accountId);
    delDiaries.run(accountId);
    delDiaryTasks.run(accountId);
    let quests = 0, goalCount = 0, questGoalCount = 0, presetGoalCount = 0, diaryCount = 0, diaryTaskCount = 0;
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
    const seenQG = new Set();
    for (const q of (Array.isArray(questGoals) ? questGoals : [])) {
      if (typeof q !== 'string' || !q || seenQG.has(q)) continue;
      seenQG.add(q);
      insQGoal.run(accountId, q);
      questGoalCount++;
    }
    const seenPG = new Set();
    for (const k of (Array.isArray(presetGoals) ? presetGoals : [])) {
      if (typeof k !== 'string' || !k || seenPG.has(k)) continue;
      seenPG.add(k);
      insPGoal.run(accountId, k);
      presetGoalCount++;
    }
    const seenD = new Set();
    for (const d of (Array.isArray(diaries) ? diaries : [])) {
      if (!d || typeof d.region !== 'string' || !d.region || typeof d.tier !== 'string' || !d.tier) continue;
      const key = d.region + '|' + d.tier;
      if (seenD.has(key)) continue;
      seenD.add(key);
      insDiary.run(accountId, d.region, d.tier);
      diaryCount++;
    }
    const seenDT = new Set();
    for (const id of (Array.isArray(diaryTasks) ? diaryTasks : [])) {
      if (typeof id !== 'string' || !id || seenDT.has(id)) continue;
      seenDT.add(id);
      insDiaryTask.run(accountId, id);
      diaryTaskCount++;
    }
    return { quests, goals: goalCount, questGoals: questGoalCount, presetGoals: presetGoalCount, diaries: diaryCount, diaryTasks: diaryTaskCount };
  });

  function setState(accountId, payload) {
    const body = payload || {};
    return replaceTx(accountId, body.completed || {}, body.goals || [], body.questGoals || [], body.presetGoals || [], body.diaries || [], body.diaryTasks || []);
  }

  // Additive, non-destructive single-quest completion (used by telemetry ingest).
  // Unlike setState (full replace), this won't touch goals/quest_goals/preset_goals.
  // Returns true if the quest was newly marked complete.
  function addQuestCompletion(accountId, quest) {
    if (typeof quest !== 'string' || !quest) return false;
    const info = db.prepare(
      'INSERT OR IGNORE INTO quest_completions (account_id, quest) VALUES (?, ?)'
    ).run(accountId, quest);
    return info.changes > 0;
  }

  // Additive, non-destructive diary-tier completion (used by Dink telemetry ingest).
  // Won't touch the rest of state. Returns true if the tier was newly marked complete.
  function addDiaryCompletion(accountId, region, tier) {
    if (typeof region !== 'string' || !region || typeof tier !== 'string' || !tier) return false;
    const info = db.prepare(
      'INSERT OR IGNORE INTO diary_completions (account_id, region, tier) VALUES (?, ?, ?)'
    ).run(accountId, region, tier);
    return info.changes > 0;
  }

  function count(accountId) {
    const q = db.prepare('SELECT COUNT(*) AS c FROM quest_completions WHERE account_id = ?').get(accountId).c;
    const g = db.prepare('SELECT COUNT(*) AS c FROM goals WHERE account_id = ?').get(accountId).c;
    const qg = db.prepare('SELECT COUNT(*) AS c FROM quest_goals WHERE account_id = ?').get(accountId).c;
    const pg = db.prepare('SELECT COUNT(*) AS c FROM preset_goals WHERE account_id = ?').get(accountId).c;
    return q + g + qg + pg;
  }

  // One-time seed from the old vault state markdown (the ```json block).
  function importFromVaultMarkdown(accountId, mdText) {
    const m = mdText.match(/```json\s*([\s\S]*?)```/);
    if (!m) return { quests: 0, goals: 0 };
    let data;
    try { data = JSON.parse(m[1]); } catch { return { quests: 0, goals: 0 }; }
    return replaceTx(accountId, data.completed || {}, Array.isArray(data.goals) ? data.goals : [], Array.isArray(data.questGoals) ? data.questGoals : [], Array.isArray(data.presetGoals) ? data.presetGoals : []);
  }

  return { getState, setState, addQuestCompletion, addDiaryCompletion, count, importFromVaultMarkdown };
};
