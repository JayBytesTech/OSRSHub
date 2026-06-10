'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5173;
const VAULT_PATH = process.env.VAULT_PATH || '/home/jaybytestech/Documents/Necronomicon';
const STATE_REL = process.env.STATE_REL || 'Gaming/OSRS/OSRS Hub State.md';
const HISTORY_REL = process.env.HISTORY_REL || 'Gaming/OSRS/OSRS Hiscores History.md';
const RSN = process.env.RSN || 'Nullyn Voyd';
const MODEL = process.env.MODEL || 'claude-opus-4-8';
const ENABLE_WEB_SEARCH = (process.env.ENABLE_WEB_SEARCH || 'true') !== 'false';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

const anthropic = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// SQLite store (history/time-series + account scoping). Vault stays for human notes.
const { getCurrentAccount, snapshots, state, accountValue, checklist, events } = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Vault helpers (path-confined to the vault root) ───────────────────────────
function safeVaultPath(rel) {
  const abs = path.resolve(VAULT_PATH, rel);
  if (abs !== VAULT_PATH && !abs.startsWith(VAULT_PATH + path.sep)) {
    throw new Error('Path escapes vault root: ' + rel);
  }
  return abs;
}

// ── State API (quest completions + goals, backed by SQLite) ───────────────────
app.get('/api/state', (_req, res) => {
  try {
    const account = getCurrentAccount();
    res.json(state.getState(account.id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/state', (req, res) => {
  try {
    const account = getCurrentAccount();
    state.setState(account.id, req.body || {});   // full replace of this account's state
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Checklist API (daily/weekly recurring tasks, backed by SQLite) ────────────
app.get('/api/checklist', (_req, res) => {
  try {
    const account = getCurrentAccount();
    res.json(checklist.getChecklist(account.id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/checklist', (req, res) => {
  try {
    const account = getCurrentAccount();
    checklist.setChecklist(account.id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Account Value trend (composite score computed client-side, persisted daily) ──
const clampPct = (v) => (v == null ? null : Math.max(0, Math.min(100, Number(v))));

app.get('/api/account-value', (_req, res) => {
  try {
    const account = getCurrentAccount();
    res.json(accountValue.getTrend(account.id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/account-value', (req, res) => {
  try {
    const score = Number((req.body || {}).score);
    if (!Number.isFinite(score)) return res.status(400).json({ error: 'score must be a number' });
    const account = getCurrentAccount();
    accountValue.record(account.id, todayLabel(), {
      score: Math.max(0, Math.min(100, score)),
      skillsPct: clampPct((req.body || {}).skillsPct),
      questsPct: clampPct((req.body || {}).questsPct),
    });
    res.json({ ok: true, trend: accountValue.getTrend(account.id) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Telemetry ingest (passive) + Account Timeline (F3.1/F3.4) ─────────────────
// Receives RuneLite webhooks (Dink today; a custom plugin later) and records them as
// account-scoped events. Passive only — we never act on the game (ADR D2). Dink posts
// multipart/form-data with a `payload_json` text field (+ optional screenshot file), so
// multer parses that one route; raw application/json is still accepted for testing.
const multer = require('multer');
const ingestUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';

const sumLootValue = (items) =>
  (Array.isArray(items) ? items : []).reduce((s, it) =>
    s + (Number(it && it.quantity) || 0) * (Number(it && (it.priceEach ?? it.price)) || 0), 0);

// Map a Dink payload → array of { type, summary, data }. Unknown event types fall
// through to a generic 'other' row so nothing is silently dropped.
function normalizeDinkEvent(payload) {
  const p = payload || {};
  const extra = p.extra || {};
  const out = [];
  switch (p.type) {
    case 'LEVEL': {
      const levelled = extra.levelledSkills || extra.levelledSkill || {};
      for (const skill in levelled) {
        out.push({ type: 'level', summary: `🎉 Reached level ${levelled[skill]} ${skill}`,
                   data: { skill, level: levelled[skill] } });
      }
      if (!out.length && extra.combatLevel && extra.combatLevel.value) {
        out.push({ type: 'level', summary: `🎉 Combat level ${extra.combatLevel.value}`, data: extra.combatLevel });
      }
      break;
    }
    case 'QUEST': {
      const name = extra.questName || extra.quest || '';
      out.push({ type: 'quest', summary: `📜 Completed quest: ${name || 'Unknown'}`,
                 data: { questName: name, questPoints: extra.questPoints, completedQuests: extra.completedQuests, totalQuests: extra.totalQuests } });
      break;
    }
    case 'LOOT': {
      const items = extra.items || [];
      const value = sumLootValue(items);
      const names = items.map(it => `${it.name}${it.quantity > 1 ? ' x' + it.quantity : ''}`).filter(Boolean);
      const src = extra.source || extra.npcName || 'Loot';
      out.push({ type: 'loot', summary: `💰 ${src}: ${value.toLocaleString()} gp${names.length ? ' (' + names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') + ')' : ''}`,
                 data: { source: src, value, items, category: extra.category || null } });
      break;
    }
    case 'KILL_COUNT': {
      const boss = extra.boss || extra.bossName || extra.source || 'Boss';
      const count = Number(extra.count != null ? extra.count : extra.killCount);
      out.push({ type: 'kc', summary: `⚔️ ${boss} KC: ${Number.isFinite(count) ? count.toLocaleString() : '?'}`,
                 data: { boss, count: Number.isFinite(count) ? count : null } });
      break;
    }
    case 'ACHIEVEMENT_DIARY': {
      const region = extra.area || extra.diaryName || '';
      const d = String(extra.difficulty || '');                       // Dink sends UPPERCASE
      const tier = d ? d.charAt(0).toUpperCase() + d.slice(1).toLowerCase() : '';
      out.push({ type: 'diary', summary: `📖 ${region || 'Diary'} ${tier} diary complete`,
                 data: { region, tier } });
      break;
    }
    case 'COLLECTION': {
      const item = extra.itemName || 'item';
      const done = Number(extra.completedEntries), total = Number(extra.totalEntries);
      const prog = (Number.isFinite(done) && Number.isFinite(total)) ? ` (${done}/${total})` : '';
      out.push({ type: 'clog', summary: `📒 New collection log: ${item}${prog}`,
                 data: { itemName: item, completedEntries: Number.isFinite(done) ? done : null,
                         totalEntries: Number.isFinite(total) ? total : null, price: Number(extra.price) || 0 } });
      break;
    }
    case 'CLUE': {
      const tier = extra.clueType || extra.clueScrollType || 'Clue';
      const n = Number(extra.numberCompleted);
      const value = sumLootValue(extra.items || []);
      out.push({ type: 'clue', summary: `🗺️ ${tier} clue completed${Number.isFinite(n) ? ` (#${n})` : ''}`,
                 data: { clueType: tier, numberCompleted: Number.isFinite(n) ? n : null, value } });
      break;
    }
    case 'COMBAT_ACHIEVEMENT': {
      const task = extra.task || 'task';
      const tier = extra.tier || '';
      const points = Number(extra.totalPoints);
      out.push({ type: 'ca', summary: `🏅 Combat achievement: ${task}${tier ? ` (${tier})` : ''}`,
                 data: { task, tier, totalPoints: Number.isFinite(points) ? points : null,
                         taskPoints: Number(extra.taskPoints) || null } });
      break;
    }
    case 'PET': {
      const pet = extra.petName || '';
      const dup = !!extra.duplicate;
      out.push({ type: 'pet', summary: `🐾 Pet${pet ? `: ${pet}` : ''}${dup ? ' (duplicate)' : ''}${extra.milestone ? ` — ${extra.milestone}` : ''}`,
                 data: { petName: pet || null, duplicate: dup, milestone: extra.milestone || null } });
      break;
    }
    case 'SLAYER': {
      const task = extra.slayerTask || 'task';
      const completed = extra.slayerCompleted != null ? String(extra.slayerCompleted) : null;
      out.push({ type: 'slayer', summary: `💀 Slayer task complete: ${task}${completed ? ` (${completed} done)` : ''}`,
                 data: { slayerTask: task, slayerCompleted: completed, slayerPoints: extra.slayerPoints != null ? String(extra.slayerPoints) : null } });
      break;
    }
    case 'DEATH': {
      const lost = Number(extra.valueLost) || 0;
      const killer = extra.killerName || '';
      out.push({ type: 'death', summary: `☠️ Died${killer ? ` to ${killer}` : ''}${lost ? ` — ${lost.toLocaleString()} gp lost` : ''}`,
                 data: { valueLost: lost, isPvp: !!extra.isPvp, killerName: killer || null } });
      break;
    }
    default: {
      const label = (p.text && String(p.text).trim()) || (p.type ? `${p.type} event` : 'Game event');
      out.push({ type: 'other', summary: `📌 ${label}`, data: extra });
    }
  }
  return out;
}

app.post('/api/ingest', ingestUpload.any(), (req, res) => {
  try {
    if (INGEST_TOKEN && req.query.token !== INGEST_TOKEN) {
      return res.status(401).json({ error: 'invalid or missing token' });
    }
    let payload = req.body || {};
    if (payload.payload_json) {
      try { payload = JSON.parse(payload.payload_json); } catch { return res.status(400).json({ error: 'payload_json is not valid JSON' }); }
    }
    const account = getCurrentAccount();
    const nowIso = new Date().toISOString();
    const minute = nowIso.slice(0, 16);            // YYYY-MM-DDTHH:mm (dedupe granularity)
    const normalized = normalizeDinkEvent(payload);
    let stored = 0, questsTicked = 0, diariesTicked = 0;
    for (const ev of normalized) {
      if (ev.type === 'quest' && ev.data && ev.data.questName) {
        if (state.addQuestCompletion(account.id, ev.data.questName)) questsTicked++;
      }
      if (ev.type === 'diary' && ev.data && ev.data.region && ev.data.tier) {
        if (state.addDiaryCompletion(account.id, ev.data.region, ev.data.tier)) diariesTicked++;
      }
      const inserted = events.addEvent(account.id, {
        type: ev.type, occurred_at: nowIso, summary: ev.summary, data: ev.data,
        source: 'dink', dedupe_key: `${ev.type}|${ev.summary}|${minute}`,
      });
      if (inserted) stored++;
    }
    console.log(`[ingest] type=${(payload && payload.type) || '?'} received=${normalized.length} stored=${stored}${questsTicked ? ` questsTicked=${questsTicked}` : ''}${diariesTicked ? ` diariesTicked=${diariesTicked}` : ''}`);
    res.json({ ok: true, stored, questsTicked, diariesTicked });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/timeline', (_req, res) => {
  try {
    const account = getCurrentAccount();
    res.json({ events: events.recent(account.id, 50) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/loot', (_req, res) => {
  try {
    const account = getCurrentAccount();
    res.json(events.lootSummary(account.id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/milestones', (_req, res) => {
  try {
    const account = getCurrentAccount();
    res.json(events.milestonesSummary(account.id));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Live stats from the OSRS Hiscores ─────────────────────────────────────────
// Hiscores skill name → hub name (only where they differ). Snapshots are stored by
// skill name in SQLite, so there is no longer a positional skill-order coupling.
const HISCORE_NAME_MAP = { Runecraft: 'Runecrafting' };

async function fetchHiscores() {
  const url = 'https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=' +
    encodeURIComponent(RSN);
  const r = await fetch(url, { headers: { 'User-Agent': 'osrs-hub-local' } });
  if (!r.ok) throw new Error('Hiscores HTTP ' + r.status + (r.status === 404 ? ' (RSN not found?)' : ''));
  const data = await r.json();
  const stats = {};
  for (const s of data.skills || []) {
    const name = HISCORE_NAME_MAP[s.name] || s.name;
    stats[name] = [Number(s.rank), Number(s.level), Number(s.xp)];
  }
  if (!stats.Overall) throw new Error('Unexpected Hiscores response (no skills)');
  return stats;
}

function todayLabel() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await fetchHiscores();
    const account = getCurrentAccount();
    snapshots.recordSnapshot(account.id, todayLabel(), stats);   // upsert today's per-skill rows
    const history = snapshots.getHistory(account.id);            // legacy { dates, skills } shape
    res.json({ stats, history, rsn: RSN });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Money methods (structured data from the vault) ────────────────────────────
const MONEY_REL = process.env.MONEY_REL || 'Gaming/OSRS/OSRS Money Methods Data.md';

app.get('/api/money', async (_req, res) => {
  try {
    let md = '';
    try { md = await fs.readFile(safeVaultPath(MONEY_REL), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return res.json({ methods: [], endgame: [] }); throw e; }
    const m = md.match(/```json\s*([\s\S]*?)```/);
    if (!m) return res.json({ methods: [], endgame: [] });
    const data = JSON.parse(m[1]);
    res.json({ methods: data.methods || [], endgame: data.endgame || [], reviewed: data.reviewed || null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Live GE prices → GP/hr (OSRS Wiki real-time prices API) ───────────────────
const PRICES_BASE = 'https://prices.runescape.wiki/api/v1/osrs';
const PRICE_UA = process.env.PRICE_UA || 'osrs-hub-local (personal progression hub)';
let mappingCache = null;            // name(lower) → id, fetched once
let pricesCache = { at: 0, data: null };
const PRICES_TTL_MS = 60 * 1000;    // be gentle on the wiki API

async function getMapping() {
  if (mappingCache) return mappingCache;
  const r = await fetch(PRICES_BASE + '/mapping', { headers: { 'User-Agent': PRICE_UA } });
  if (!r.ok) throw new Error('mapping HTTP ' + r.status);
  const arr = await r.json();
  mappingCache = new Map(arr.map((x) => [x.name.toLowerCase(), x.id]));
  return mappingCache;
}

async function getPrices() {
  if (pricesCache.data && Date.now() - pricesCache.at < PRICES_TTL_MS) return pricesCache.data;
  const r = await fetch(PRICES_BASE + '/latest', { headers: { 'User-Agent': PRICE_UA } });
  if (!r.ok) throw new Error('prices HTTP ' + r.status);
  const j = await r.json();
  pricesCache = { at: Date.now(), data: j.data };
  return j.data;
}

// Mid price (avg of instant-buy/sell), falling back to whichever side exists.
function midPrice(prices, id) {
  const p = prices[String(id)];
  if (!p) return null;
  if (p.high != null && p.low != null) return Math.round((p.high + p.low) / 2);
  return p.high ?? p.low ?? null;
}

async function priceOf(mapping, prices, name) {
  const id = mapping.get(String(name).toLowerCase());
  if (id == null) return { name, price: null, error: 'unmapped' };
  return { name, id, price: midPrice(prices, id) };
}

// GP/hr for one method from its output/cost throughput model. null if not modeled.
async function computeMethodGp(mapping, prices, m) {
  if (!Array.isArray(m.output) || !m.output.length) return null;
  const breakdown = [];
  let gp = 0;
  for (const o of m.output) {
    const pr = await priceOf(mapping, prices, o.item);
    if (pr.price == null) return { gphr: null, error: 'no price for ' + o.item };
    const subtotal = pr.price * o.qtyPerHr;
    gp += subtotal;
    breakdown.push({ item: o.item, qtyPerHr: o.qtyPerHr, price: pr.price, subtotal });
  }
  for (const c of m.cost || []) {
    const pr = await priceOf(mapping, prices, c.item);
    if (pr.price == null) return { gphr: null, error: 'no price for ' + c.item };
    const subtotal = -pr.price * c.qtyPerHr;
    gp += subtotal;
    breakdown.push({ item: c.item, qtyPerHr: c.qtyPerHr, price: pr.price, subtotal });
  }
  return { gphr: Math.round(gp), breakdown };
}

app.get('/api/gephr', async (_req, res) => {
  try {
    let md = '';
    try { md = await fs.readFile(safeVaultPath(MONEY_REL), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return res.json({ updated: null, methods: {} }); throw e; }
    const block = md.match(/```json\s*([\s\S]*?)```/);
    const methods = block ? (JSON.parse(block[1]).methods || []) : [];
    const [mapping, prices] = await Promise.all([getMapping(), getPrices()]);
    const out = {};
    for (const m of methods) {
      const r = await computeMethodGp(mapping, prices, m);
      if (r && r.gphr != null) out[m.name] = r;
    }
    res.json({ updated: new Date().toISOString(), methods: out });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Vault tools for the chat agent ────────────────────────────────────────────
async function walkMarkdown(dir, acc) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walkMarkdown(full, acc);
    else if (ent.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

async function toolSearchVault({ query }) {
  if (!query) return 'No query provided.';
  const files = await walkMarkdown(VAULT_PATH, []);
  const q = query.toLowerCase();
  const hits = [];
  for (const f of files) {
    let text;
    try { text = await fs.readFile(f, 'utf8'); } catch { continue; }
    const idx = text.toLowerCase().indexOf(q);
    if (idx >= 0) {
      const snippet = text.slice(Math.max(0, idx - 120), idx + 180).replace(/\s+/g, ' ').trim();
      hits.push(`• ${path.relative(VAULT_PATH, f)}\n  …${snippet}…`);
      if (hits.length >= 12) break;
    }
  }
  return hits.length ? hits.join('\n') : `No matches for "${query}".`;
}

async function toolReadNote({ path: rel }) {
  try {
    const text = await fs.readFile(safeVaultPath(rel), 'utf8');
    return text.length > 12000 ? text.slice(0, 12000) + '\n…[truncated]' : text;
  } catch (e) {
    return 'Could not read note: ' + String(e);
  }
}

async function toolAppendNote({ path: rel, content }) {
  try {
    const abs = safeVaultPath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const prefix = (await fs.readFile(abs, 'utf8').catch(() => '')) ? '\n' : '';
    await fs.appendFile(abs, prefix + content + '\n', 'utf8');
    return `Appended ${content.length} chars to ${rel}.`;
  } catch (e) {
    return 'Could not append: ' + String(e);
  }
}

const TOOL_RUNNERS = {
  search_vault: toolSearchVault,
  read_note: toolReadNote,
  append_note: toolAppendNote,
};

const VAULT_TOOLS = [
  { name: 'search_vault', description: 'Full-text search the Obsidian vault markdown notes. Returns matching files with snippets.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for' } }, required: ['query'] } },
  { name: 'read_note', description: 'Read a markdown note by vault-relative path, e.g. "Gaming/OSRS/OSRS Daily Log.md".',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'append_note', description: 'Append text to a vault note (creates it if missing). Use to log drops, sessions, decisions, or journal entries.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
];

function buildTools(withWeb) {
  const tools = VAULT_TOOLS.slice();
  if (withWeb) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
  return tools;
}

const SYSTEM = `You are Nullyn Voyd's personal Old School RuneScape (OSRS) guide and journaling companion.
You have live tools to read and search the player's Obsidian vault, append to their notes, and search the web (use the OSRS Wiki, oldschool.runescape.wiki, as the authoritative source for game mechanics, drop rates, and quest requirements).

Their OSRS notes live under "Gaming/OSRS/" — key files: "OSRS Progression Roadmap.md", "OSRS Daily Log.md", "OSRS Money Methods.md".
When the player asks you to log, record, or note something, append it to the appropriate vault file (default to the Daily Log for session notes). Confirm what you wrote.
Be specific and grounded: prefer the player's real levels/quests (provided as context) and verified wiki facts over guesses. Keep answers focused, no filler.`;

// ── Chat API (tool-use loop) ──────────────────────────────────────────────────
async function runChat({ message, history, context }, withWeb) {
  const system = context ? `${SYSTEM}\n\nCurrent account snapshot:\n${context}` : SYSTEM;
  const messages = (Array.isArray(history) ? history : []).concat([{ role: 'user', content: message }]);

  for (let turn = 0; turn < 8; turn++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      tools: buildTools(withWeb),
      messages,
    });

    if (resp.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use' && TOOL_RUNNERS[block.name]) {
          const out = await TOOL_RUNNERS[block.name](block.input || {});
          results.push({ type: 'tool_result', tool_use_id: block.id, content: String(out) });
        }
      }
      if (!results.length) break; // only server-side tools left; shouldn't loop
      messages.push({ role: 'user', content: results });
      continue;
    }

    return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  return 'I got stuck working through that — try rephrasing.';
}

app.post('/api/chat', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to .env and restart.' });
  try {
    const reply = await runChat(req.body || {}, ENABLE_WEB_SEARCH);
    res.json({ reply });
  } catch (e) {
    // Fall back without web search if the tool isn't enabled on the account.
    if (ENABLE_WEB_SEARCH && /web_search|tool/i.test(String(e))) {
      try {
        const reply = await runChat(req.body || {}, false);
        return res.json({ reply, note: 'web search unavailable; answered from vault + knowledge only' });
      } catch (e2) { return res.status(500).json({ error: String(e2) }); }
    }
    res.status(500).json({ error: String(e) });
  }
});

(async () => {
  // One-time seed: import legacy vault history into SQLite if this account has none yet.
  const account = getCurrentAccount();
  if (snapshots.count(account.id) === 0) {
    try {
      const md = await fs.readFile(safeVaultPath(HISTORY_REL), 'utf8');
      const imported = snapshots.importFromVaultMarkdown(account.id, md);
      if (imported) console.log(`Imported ${imported} history snapshots from vault → SQLite`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('History import skipped:', e.message);
    }
  }

  // One-time seed: import legacy vault quest/goal state into SQLite if this account has none yet.
  if (state.count(account.id) === 0) {
    try {
      const md = await fs.readFile(safeVaultPath(STATE_REL), 'utf8');
      const r = state.importFromVaultMarkdown(account.id, md);
      if (r.quests || r.goals) console.log(`Imported state from vault → SQLite (${r.quests} quests, ${r.goals} goals)`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('State import skipped:', e.message);
    }
  }

  // One-time seed: populate checklist presets if this account has no tasks yet.
  if (checklist.count(account.id) === 0) {
    const presets = [
      { task_id: 'preset_battlestaves', title: 'Buy battlestaves from Zaff', frequency: 'daily',  sort_order: 0 },
      { task_id: 'preset_herb_run',     title: 'Herb run',                   frequency: 'daily',  sort_order: 1 },
      { task_id: 'preset_birdhouse',    title: 'Birdhouse run',              frequency: 'daily',  sort_order: 2 },
      { task_id: 'preset_kingdom',      title: 'Check Miscellania kingdom',  frequency: 'daily',  sort_order: 3 },
      { task_id: 'preset_farming_run',  title: 'Farming run',                frequency: 'daily',  sort_order: 4 },
      { task_id: 'preset_slayer',       title: 'Slayer task',                frequency: 'daily',  sort_order: 5 },
      { task_id: 'preset_tog',          title: 'Tears of Guthix',            frequency: 'weekly', sort_order: 0 },
      { task_id: 'preset_penguins',     title: 'Penguin points',             frequency: 'weekly', sort_order: 1 },
      { task_id: 'preset_circus',       title: 'The Circus',                 frequency: 'weekly', sort_order: 2 },
      { task_id: 'preset_stars',        title: 'Shooting Stars',             frequency: 'weekly', sort_order: 3 },
    ].map(t => ({ ...t, enabled: 1, is_preset: 1, last_completed: null }));
    const r = checklist.setChecklist(account.id, { tasks: presets });
    console.log(`Seeded ${r.tasks} checklist presets`);
  }

  app.listen(PORT, () => {
    console.log(`OSRS Hub running → http://localhost:${PORT}`);
    console.log(`Vault: ${VAULT_PATH}`);
    console.log(`State file: ${STATE_REL}`);
    console.log(`Hiscores RSN: ${RSN}`);
    console.log(`DB: ${process.env.DB_PATH || 'data/osrs-hub.db'}`);
    console.log(`Chat: ${anthropic ? MODEL : 'DISABLED (no ANTHROPIC_API_KEY)'}${anthropic && ENABLE_WEB_SEARCH ? ' + web search' : ''}`);
  });
})();
