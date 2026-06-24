'use strict';

// Vault live snapshot (ADR 0004): a ONE-WAY projection of the SQLite source of truth into a
// hub-owned, human-readable Obsidian note, so the chat (and any Obsidian-side AI) always reads
// current account data. Nothing is ever read back from this note — it is regenerated wholesale on
// change (debounced). Writes go through the injected `writeNote`, which is path-confined.
//
//   makeVaultLive({ db, writeNote, liveRel }) -> { scheduleSync, syncNow }
//
// `db` is the ./db module (getCurrentAccount + repos + raw handle as db.db).
// `writeNote(rel, content)` is provided by server.js (safeVaultPath + fs.writeFile).

const COMBAT_SKILLS = ['Attack', 'Strength', 'Defence', 'Hitpoints', 'Ranged', 'Prayer', 'Magic'];

module.exports = function makeVaultLive({ db, writeNote, liveRel, debounceMs = 4000 }) {
  const handle = db.db;

  // ---- datasets (lazy, optional — for denominators) --------------------------
  let _totals = null;
  function totals() {
    if (_totals) return _totals;
    _totals = { quests: null, caTasks: null };
    try { _totals.quests = Object.keys(require('./public/quest-data.json').quests || {}).length || null; } catch {}
    try { _totals.caTasks = (require('./public/ca-data.json').tasks || []).length || null; } catch {}
    return _totals;
  }

  // ---- data access -----------------------------------------------------------
  function latestLevels(accountId) {
    const maxDate = handle.prepare('SELECT MAX(date) AS d FROM skill_snapshots WHERE account_id = ?').get(accountId).d;
    if (!maxDate) return { date: null, rows: [] };
    const rows = handle.prepare(
      'SELECT skill, level, xp FROM skill_snapshots WHERE account_id = ? AND date = ? ORDER BY skill'
    ).all(accountId, maxDate);
    return { date: maxDate, rows };
  }

  function combatLevel(byName) {
    const g = (s) => Number(byName[s] || 1);
    const base = 0.25 * (g('Defence') + g('Hitpoints') + Math.floor(g('Prayer') / 2));
    const melee = 0.325 * (g('Attack') + g('Strength'));
    const range = 0.325 * Math.floor(3 * g('Ranged') / 2);
    const mage = 0.325 * Math.floor(3 * g('Magic') / 2);
    return Math.floor(base + Math.max(melee, range, mage));
  }

  function weeklyXp(accountId) {
    const dates = handle.prepare('SELECT DISTINCT date FROM skill_snapshots WHERE account_id = ? ORDER BY date').all(accountId).map(r => r.date);
    if (dates.length < 2) return null;
    const latest = dates[dates.length - 1];
    const cutoff = isoDateMinusDays(latest, 7);
    let weekAgo = dates[0];
    for (const d of dates) { if (d <= cutoff) weekAgo = d; }
    if (weekAgo === latest) return null;
    const sum = (d) => handle.prepare('SELECT SUM(xp) AS s FROM skill_snapshots WHERE account_id = ? AND date = ?').get(accountId, d).s || 0;
    const a = sum(weekAgo), b = sum(latest);
    if (a <= 0 || b <= 0 || b < a) return null;            // null xp on imported rows -> skip
    return { gained: b - a, from: weekAgo, to: latest };
  }

  function weeklyEvents(accountId) {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const rows = handle.prepare(
      'SELECT type, data FROM account_events WHERE account_id = ? AND occurred_at >= ?'
    ).all(accountId, since);
    const by = {};
    let lootValue = 0;
    for (const r of rows) {
      by[r.type] = (by[r.type] || 0) + 1;
      if (r.type === 'loot' && r.data) { try { lootValue += Number(JSON.parse(r.data).value) || 0; } catch {} }
    }
    return { by, lootValue, total: rows.length };
  }

  function profileStats(accountId) {
    const out = {};
    for (const r of handle.prepare('SELECT key, value_num, value_str FROM profile_stats WHERE account_id = ?').all(accountId)) {
      out[r.key] = r.value_num != null ? r.value_num : r.value_str;
    }
    return out;
  }

  // ---- markdown rendering ----------------------------------------------------
  function buildMarkdown() {
    const account = db.getCurrentAccount();
    const id = account.id;
    const name = account.displayName || account.rsn;
    const T = totals();

    const { date: levelDate, rows: levels } = latestLevels(id);
    const byName = {}; for (const r of levels) byName[r.skill] = r.level;
    const totalLevel = levels.reduce((s, r) => s + (r.level || 0), 0);
    const combat = levels.length ? combatLevel(byName) : null;

    const st = db.state.getState(id);
    const questsDone = Object.values(st.completed || {}).filter(Boolean).length;
    const diariesDone = (st.diaries || []).length;
    const caDone = (st.caTasks || []).length;

    const stats = profileStats(id);
    const bank = db.bank.latest(id);
    const recent = db.events.recent(id, 25);
    const wkXp = weeklyXp(id);
    const wkEv = weeklyEvents(id);
    const lastSession = db.sessions.recent(id, 1)[0] || null;

    const now = new Date();
    const L = [];
    L.push('---');
    L.push('generated: true');
    L.push('source: OSRS Hub (SQLite)');
    L.push('updated: ' + now.toISOString());
    L.push('---');
    L.push('');
    L.push('# OSRS Hub — Live Snapshot');
    L.push('');
    L.push('> ⚙️ **Auto-generated by OSRS Hub from its database.** Do not hand-edit — this note is');
    L.push('> overwritten on every change. It mirrors the hub\'s current data so chat/AI stays up to date.');
    L.push('');
    const head = [`**RSN:** ${name}`];
    if (combat != null) head.push(`**Combat:** ${combat}`);
    if (levels.length) head.push(`**Total level:** ${totalLevel.toLocaleString()}`);
    if (bank) head.push(`**Bank:** ${fmt(bank.value)}`);
    L.push(head.join('  ·  '));
    L.push('');
    L.push(`*Updated ${stamp(now)}${levelDate ? ` · levels as of ${levelDate}` : ''}.*`);
    L.push('');

    // Skills
    if (levels.length) {
      L.push('## Skills');
      L.push('');
      L.push('| Skill | Level | XP |');
      L.push('|-------|------:|---:|');
      for (const r of levels) L.push(`| ${r.skill} | ${r.level} | ${r.xp != null ? Number(r.xp).toLocaleString() : '—'} |`);
      L.push(`| **Total** | **${totalLevel.toLocaleString()}** | |`);
      L.push('');
    }

    // Progress
    L.push('## Progress');
    L.push('');
    L.push(`- **Quests:** ${questsDone}${T.quests ? ` / ${T.quests}` : ''} complete`);
    L.push(`- **Achievement diaries:** ${diariesDone} tier${diariesDone === 1 ? '' : 's'} complete`);
    L.push(`- **Combat achievements:** ${caDone}${T.caTasks ? ` / ${T.caTasks}` : ''}${stats['ca.totalPoints'] != null ? ` · ${stats['ca.totalPoints']} pts` : ''}`);
    if (stats['questPoints'] != null) L.push(`- **Quest points:** ${stats['questPoints']}`);
    if (stats['slayer.points'] != null || stats['slayer.task'] != null) {
      const bits = [];
      if (stats['slayer.points'] != null) bits.push(`${stats['slayer.points']} pts`);
      if (stats['slayer.streak'] != null) bits.push(`streak ${stats['slayer.streak']}`);
      if (stats['slayer.task'] != null) bits.push(`task: ${stats['slayer.task']}`);
      L.push(`- **Slayer:** ${bits.join(' · ')}`);
    }
    if (stats['clog.unique'] != null) L.push(`- **Collection log:** ${stats['clog.unique']}${stats['clog.total'] != null ? ` / ${stats['clog.total']}` : ''} unique`);
    L.push('');

    // Goals
    const goalLines = [];
    for (const g of (st.goals || [])) goalLines.push(`- ${g.skill} → level ${g.target}`);
    for (const q of (st.questGoals || [])) goalLines.push(`- Quest: ${q}`);
    for (const u of (st.unlockGoals || [])) goalLines.push(`- Unlock: ${u}`);
    for (const mg of (st.moneyGoals || [])) goalLines.push(`- Save ${fmt(mg.amount)}${mg.label ? ` for ${mg.label}` : ''}`);
    if (goalLines.length) {
      L.push('## Active goals');
      L.push('');
      L.push(...goalLines);
      L.push('');
    }

    // This week
    const wkBits = [];
    if (wkXp) wkBits.push(`**+${fmt(wkXp.gained)} XP**`);
    const eb = wkEv.by;
    if (eb.level) wkBits.push(`${eb.level} level-up${eb.level > 1 ? 's' : ''}`);
    if (eb.quest) wkBits.push(`${eb.quest} quest${eb.quest > 1 ? 's' : ''}`);
    if (eb.diary) wkBits.push(`${eb.diary} diary tier${eb.diary > 1 ? 's' : ''}`);
    if (eb.ca) wkBits.push(`${eb.ca} combat achievement${eb.ca > 1 ? 's' : ''}`);
    if (eb.clue) wkBits.push(`${eb.clue} clue${eb.clue > 1 ? 's' : ''}`);
    if (wkEv.lootValue > 0) wkBits.push(`${fmt(wkEv.lootValue)} loot`);
    if (eb.death) wkBits.push(`${eb.death} death${eb.death > 1 ? 's' : ''}`);
    if (wkBits.length) {
      L.push('## This week');
      L.push('');
      L.push(wkBits.join(' · '));
      L.push('');
    }

    // Last / current session (ADR 0006 Phase 2)
    if (lastSession) {
      const s = lastSession;
      const rateBits = [`${fmtDur(s.activeSeconds)} active`];
      if (s.xpPerHour != null) rateBits.push(`${fmt(s.xpPerHour)}/hr XP`);
      if (s.gpPerHour) rateBits.push(`${fmt(s.gpPerHour)}/hr gp`);
      const skills = s.perSkill ? Object.entries(s.perSkill).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
      const res = s.resources ? Object.entries(s.resources).sort((a, b) => b[1] - a[1]).slice(0, 8) : [];
      L.push(`## ${s.final ? 'Last session' : 'Current session'}`);
      L.push('');
      L.push(`*${rateBits.join(' · ')}${s.final ? '' : ' · live'}*`);
      if (skills.length) L.push(`- **Skills:** ${skills.map(([k, v]) => `${k} +${fmt(v)}`).join(', ')}`);
      if (res.length) L.push(`- **Gathered:** ${res.map(([k, v]) => `${k} ×${Number(v).toLocaleString()}`).join(', ')}`);
      L.push('');
    }

    // Recent activity
    if (recent.length) {
      L.push('## Recent activity');
      L.push('');
      for (const e of recent) L.push(`- \`${shortTime(e.occurred_at)}\` ${e.summary}`);
      L.push('');
    }

    L.push('---');
    L.push('*Source of truth is the OSRS Hub database; this note is a generated projection (ADR 0004).*');
    L.push('');
    return L.join('\n');
  }

  async function syncNow() {
    const md = buildMarkdown();
    await writeNote(liveRel, md);
    console.log(`[vault-live] wrote ${liveRel} (${md.length} bytes)`);
    return { ok: true, rel: liveRel, bytes: md.length };
  }

  // Debounced: coalesce rapid changes into one write. Never throws into the caller.
  let timer = null;
  function scheduleSync() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      Promise.resolve().then(syncNow).catch(e => console.warn('[vault-live] sync failed:', String(e)));
    }, debounceMs);
    if (timer.unref) timer.unref();      // don't keep the process alive for a pending sync
  }

  return { scheduleSync, syncNow, buildMarkdown };
};

// ---- utils -------------------------------------------------------------------
function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function fmtDur(secs) {
  secs = Math.max(0, Math.round(Number(secs) || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}
function stamp(d) {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
function shortTime(iso) {
  if (!iso) return '';
  const s = String(iso);
  return s.length >= 16 ? s.slice(0, 16).replace('T', ' ') : s;
}
function isoDateMinusDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
