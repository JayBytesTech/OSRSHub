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

const STATE_TEMPLATE = (payload) =>
  `---
note: Machine-managed state for the OSRS Hub app. The app reads and rewrites the JSON block below whenever you tick a quest or change a goal. Your human notes live in [[OSRS Progression Roadmap]] and [[OSRS Daily Log]].
---

# OSRS Hub — Synced State

This file is the durable store for the OSRS Hub app (quest completion + goals).
It survives browser cache wipes and stays in your vault.

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;

// ── State API ─────────────────────────────────────────────────────────────────
app.get('/api/state', async (_req, res) => {
  try {
    let md = '';
    try { md = await fs.readFile(safeVaultPath(STATE_REL), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return res.json({ completed: {}, goals: [] }); throw e; }
    const m = md.match(/```json\s*([\s\S]*?)```/);
    if (!m) return res.json({ completed: {}, goals: [] });
    const data = JSON.parse(m[1]);
    res.json({ completed: data.completed || {}, goals: Array.isArray(data.goals) ? data.goals : [] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const payload = {
      version: 1,
      updated: new Date().toISOString().slice(0, 10),
      completed: req.body.completed || {},
      goals: Array.isArray(req.body.goals) ? req.body.goals : [],
    };
    const abs = safeVaultPath(STATE_REL);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, STATE_TEMPLATE(payload), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Live stats from the OSRS Hiscores ─────────────────────────────────────────
// Must mirror SKILL_NAMES in public/index.html (order matters for Total).
const SKILL_NAMES = ['Overall', 'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged',
  'Prayer', 'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking',
  'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer',
  'Farming', 'Runecrafting', 'Hunter', 'Construction', 'Sailing'];
// Hiscores skill name → hub name (only where they differ).
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

const HISTORY_TEMPLATE = (hist) =>
  `---
note: Machine-managed progress history for the OSRS Hub. The app appends one snapshot per day from the OSRS Hiscores. Charts in the hub read the JSON block below.
---

# OSRS Hiscores History

\`\`\`json
${JSON.stringify(hist, null, 2)}
\`\`\`
`;

async function readHistory() {
  try {
    const md = await fs.readFile(safeVaultPath(HISTORY_REL), 'utf8');
    const m = md.match(/```json\s*([\s\S]*?)```/);
    if (m) { const h = JSON.parse(m[1]); h.dates = h.dates || []; h.skills = h.skills || {}; return h; }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { dates: [], skills: {} };
}

// Once-per-day: append a new column on a new day, else refresh today's values in place.
function recordSnapshot(hist, stats) {
  const label = todayLabel();
  const tracked = SKILL_NAMES.slice(1).concat(['Total']);
  const isNewDay = hist.dates[hist.dates.length - 1] !== label;
  if (isNewDay) hist.dates.push(label);
  const col = hist.dates.length - 1;
  for (const name of tracked) {
    const arr = hist.skills[name] || (hist.skills[name] = []);
    while (arr.length < col) arr.push(arr.length ? arr[arr.length - 1] : null);
    const val = name === 'Total'
      ? SKILL_NAMES.slice(1).reduce((s, n) => s + (stats[n] ? stats[n][1] : 0), 0)
      : (stats[name] ? stats[name][1] : (arr.length ? arr[arr.length - 1] : 1));
    arr[col] = val;
  }
  return hist;
}

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await fetchHiscores();
    const hist = recordSnapshot(await readHistory(), stats);
    const abs = safeVaultPath(HISTORY_REL);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, HISTORY_TEMPLATE(hist), 'utf8');
    res.json({ stats, history: hist, rsn: RSN });
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

app.listen(PORT, () => {
  console.log(`OSRS Hub running → http://localhost:${PORT}`);
  console.log(`Vault: ${VAULT_PATH}`);
  console.log(`State file: ${STATE_REL}`);
  console.log(`Hiscores RSN: ${RSN}`);
  console.log(`Chat: ${anthropic ? MODEL : 'DISABLED (no ANTHROPIC_API_KEY)'}${anthropic && ENABLE_WEB_SEARCH ? ' + web search' : ''}`);
});
