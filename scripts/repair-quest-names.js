'use strict';

/**
 * One-off repair for quest rows corrupted by the buggy baseline scan (pre-fix, ADR 0003).
 * The buggy scan stored RuneLite's Quest.getName() verbatim, which:
 *   • created orphan rows under names quest-data.json doesn't recognise, and
 *   • deleted real completions during its full-replace (rename casualties + miniquests).
 *
 * This script (review before running):
 *   1) backs up the DB,
 *   2) renames alias orphans → hub-canonical names,
 *   3) collapses Recipe for Disaster subquests (adds the atomic master only if Culinaromancer is done),
 *   4) restores known-deleted miniquests RuneLite can't see,
 *   5) prints a before/after summary.
 *
 * SAFE TO RE-RUN (idempotent). Stop the hub first if you want zero chance of write contention.
 *
 *   node scripts/repair-quest-names.js          # dry run (prints the plan, writes nothing)
 *   node scripts/repair-quest-names.js --apply   # back up + apply
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const dbm = require('../db');
const account = dbm.getCurrentAccount();
const db = dbm.db;

// RuneLite → hub-canonical aliases (same map as db/scan.js).
const ALIASES = {
  'Fairytale I - Growing Pains': 'Fairy Tale I - Growing Pains',
  'Fairytale II - Cure a Queen': 'Fairy Tale II - Cure a Queen',
  'Lost City': 'The Lost City',
  'Mage Arena I': 'The Mage Arena',
  'Mage Arena II': 'The Mage Arena II',
  'Forgettable Tale...': 'Forgettable Tale of a Drunken Dwarf',
};
const RFD_MASTER = 'Recipe for Disaster';
const RFD_FINAL = 'Recipe for Disaster - Culinaromancer';
const isRfdSub = (n) => /^Recipe for Disaster - /.test(n);

// Miniquests RuneLite's Quest enum can't report, known deleted by the buggy full-replace.
// Restored because they were tracked complete before the bad scan (per the captured pre-apply diff).
const RESTORE_MINIQUESTS = ['Natural History Quiz'];

const validQuests = new Set(Object.keys(require('../public/quest-data.json').quests));
const tracked = db.prepare('SELECT quest FROM quest_completions WHERE account_id = ?').all(account.id).map((r) => r.quest);
const trackedSet = new Set(tracked);

const toDelete = new Set();
const toAdd = new Set();

for (const q of tracked) {
  if (validQuests.has(q)) continue;                 // already canonical
  if (ALIASES[q]) { toDelete.add(q); toAdd.add(ALIASES[q]); continue; }
  if (isRfdSub(q)) { toDelete.add(q); if (q === RFD_FINAL) toAdd.add(RFD_MASTER); continue; }
  console.warn('  ? unknown orphan (left as-is, please review):', JSON.stringify(q));
}
for (const m of RESTORE_MINIQUESTS) if (!trackedSet.has(m)) toAdd.add(m);

// Don't "add" something we're also deleting, or that already exists.
for (const q of [...toAdd]) if (trackedSet.has(q) && !toDelete.has(q)) toAdd.delete(q);

console.log(`Account: ${account.rsn} (id ${account.id}) · tracked quests: ${tracked.length}`);
console.log('DELETE:', [...toDelete]);
console.log('ADD:   ', [...toAdd]);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to back up and repair.');
  process.exit(0);
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'osrs-hub.db');
const bak = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(dbPath, bak);
console.log('\nBackup written:', bak);

const delStmt = db.prepare('DELETE FROM quest_completions WHERE account_id = ? AND quest = ?');
const addStmt = db.prepare('INSERT OR IGNORE INTO quest_completions (account_id, quest) VALUES (?, ?)');
db.transaction(() => {
  for (const q of toDelete) delStmt.run(account.id, q);
  for (const q of toAdd) addStmt.run(account.id, q);
})();

const after = db.prepare('SELECT quest FROM quest_completions WHERE account_id = ?').all(account.id).map((r) => r.quest);
const orphansLeft = after.filter((n) => !validQuests.has(n));
console.log(`Done. tracked ${tracked.length} → ${after.length} · orphans remaining: ${orphansLeft.length}`, orphansLeft);
console.log('Restart the hub if it was running, so reads are fresh.');
