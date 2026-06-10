'use strict';

module.exports = function makeChecklist(db) {
  const ins = db.prepare(`
    INSERT OR REPLACE INTO checklist_tasks
      (account_id, task_id, title, frequency, enabled, is_preset, sort_order, last_completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const del = db.prepare('DELETE FROM checklist_tasks WHERE account_id = ?');

  function getChecklist(accountId) {
    const tasks = db.prepare(
      'SELECT task_id, title, frequency, enabled, is_preset, sort_order, last_completed FROM checklist_tasks WHERE account_id = ? ORDER BY sort_order, task_id'
    ).all(accountId);
    return { tasks };
  }

  const replaceTx = db.transaction((accountId, tasks) => {
    del.run(accountId);
    let count = 0;
    for (const t of (Array.isArray(tasks) ? tasks : [])) {
      if (!t || typeof t.task_id !== 'string' || !t.task_id) continue;
      if (!t.title || typeof t.title !== 'string') continue;
      if (t.frequency !== 'daily' && t.frequency !== 'weekly') continue;
      ins.run(
        accountId,
        t.task_id,
        t.title,
        t.frequency,
        t.enabled ? 1 : 0,
        t.is_preset ? 1 : 0,
        Number.isInteger(t.sort_order) ? t.sort_order : 0,
        t.last_completed || null
      );
      count++;
    }
    return { tasks: count };
  });

  function setChecklist(accountId, payload) {
    return replaceTx(accountId, (payload || {}).tasks || []);
  }

  function count(accountId) {
    return db.prepare('SELECT COUNT(*) AS c FROM checklist_tasks WHERE account_id = ?').get(accountId).c;
  }

  return { getChecklist, setChecklist, count };
};
