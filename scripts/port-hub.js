'use strict';
// Ports the Cowork artifact (osrs-hub.html) into a locally-served page:
//  - vault read/write  → /api/state  (Express + filesystem)
//  - askClaude         → /api/chat   (Express + Anthropic SDK)
//  - adds a free-form Chat tab
// Idempotent: re-run any time the source artifact changes.

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || '/home/jaybytestech/Downloads/osrs-hub.html';
const OUT = path.join(__dirname, '..', 'public', 'index.html');

// public/index.html is now the hand-edited source of truth. Refuse to clobber it
// unless --force is passed, so a stray re-port can't wipe local edits.
if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  console.error('Refusing to overwrite ' + OUT + ' — it is your edited source now.');
  console.error('If you really want to re-port from the artifact, re-run with --force');
  console.error('(consider diffing into a copy first: node scripts/port-hub.js <src> then merge).');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
function replace(needle, repl, label) {
  if (!html.includes(needle)) throw new Error('Anchor not found: ' + label);
  html = html.replace(needle, repl);
}

// 1) Persistence: swap the cowork MCP block for fetch('/api/state').
const PERSIST_START = 'function hasVaultMcp() {';
const PERSIST_END = '// ── TABS';
const sIdx = html.indexOf(PERSIST_START);
const eIdx = html.indexOf(PERSIST_END);
if (sIdx < 0 || eIdx < 0) throw new Error('persistence block not found');
const NEW_PERSIST = `async function loadVaultState() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error('state ' + r.status);
    const data = await r.json();
    if (data.completed) saveCompletedLocal(data.completed);
    if (Array.isArray(data.goals)) saveGoalsLocal(data.goals);
    SYNC.available = true;
    setSyncBadge('ok', '\\u2601 Synced to vault');
    renderQuests(); renderGoals(); populateGoalSelect();
  } catch (e) {
    SYNC.available = false; SYNC.lastError = String(e);
    setSyncBadge('warn', '\\u26a0 Local only');
  }
}

let saveTimer = null;
function scheduleVaultSave() {
  clearTimeout(saveTimer);
  setSyncBadge('', '\\u23f3 Saving\\u2026');
  saveTimer = setTimeout(saveVaultState, 700);
}
async function saveVaultState() {
  const payload = { version: 1, updated: new Date().toISOString().slice(0,10), completed: getCompleted(), goals: getGoals() };
  try {
    const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('save ' + r.status);
    SYNC.available = true;
    setSyncBadge('ok', '\\u2601 Synced to vault');
  } catch (e) {
    SYNC.available = false;
    setSyncBadge('warn', '\\u26a0 Save failed (local only)');
  }
}

`;
html = html.slice(0, sIdx) + NEW_PERSIST + html.slice(eIdx);

// 2) AI Journey: askClaude → /api/chat.
replace(
  'const result = await window.cowork.askClaude(prompt, []);',
  `const _r = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: prompt, context: chatStateContext() }) });
    if (!_r.ok) throw new Error('chat ' + _r.status);
    const result = (await _r.json()).reply;`,
  'askClaude'
);

// 3) Add the Chat tab button (after Goals).
replace(
  `<div class="tab"         onclick="switchTab('goals')">\u{1F3AF} Goals</div>`,
  `<div class="tab"         onclick="switchTab('goals')">\u{1F3AF} Goals</div>
  <div class="tab"         onclick="switchTab('chat')">\u{1F4AC} Chat</div>`,
  'chat tab button'
);

// 4) Add the Chat tab content (before <script>).
const CHAT_HTML = `
<!-- CHAT -->
<div id="tab-chat" class="tab-content">
  <div class="section-header">Chat <span class="section-sub">Claude with live access to your vault + OSRS wiki</span></div>
  <div class="chat-hint">Ask about your account, ramble about goals, or say "log today's session to my Daily Log." Claude can read/search your vault and look things up on the wiki.</div>
  <div class="chat-wrap">
    <div class="chat-log" id="chat-log"></div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="chat-input" rows="2" placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"></textarea>
      <button class="chat-send" id="chat-send" onclick="sendChat()">Send</button>
    </div>
  </div>
</div>
`;
replace('\n<script>\n// ── CONSTANTS', CHAT_HTML + '\n<script>\n// ── CONSTANTS', 'chat content');

// 5) Chat CSS (before </style></head>).
const CHAT_CSS = `
.chat-wrap { display:flex; flex-direction:column; height:60vh; min-height:360px; border:2px solid #8b6914; border-radius:6px; background:#fffdf5; overflow:hidden; }
.chat-log { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
.chat-msg { max-width:85%; padding:9px 12px; border-radius:10px; font-size:13px; line-height:1.5; white-space:pre-wrap; word-wrap:break-word; }
.chat-msg.user { align-self:flex-end; background:#4a3220; color:#f5e6b8; }
.chat-msg.bot { align-self:flex-start; background:#efe4c4; color:#2c1a08; border:1px solid #d8c590; }
.chat-msg.sys { align-self:center; color:#8a6030; font-style:italic; font-size:12px; }
.chat-input-row { display:flex; gap:8px; padding:10px; border-top:2px solid #8b6914; background:#f5edd8; }
.chat-input { flex:1; padding:9px 11px; border:1px solid #b89850; border-radius:5px; font-size:13px; font-family:inherit; resize:none; }
.chat-send { padding:9px 18px; background:#6a4a14; color:#ffd700; border:none; border-radius:5px; font-weight:600; cursor:pointer; }
.chat-send:disabled { opacity:.6; cursor:default; }
.chat-hint { font-size:11px; color:#8a6030; margin-bottom:10px; font-style:italic; }
`;
replace('</style>\n</head>', CHAT_CSS + '</style>\n</head>', 'chat css');

// 6) Chat JS + init (before the INIT block).
const CHAT_JS = `// ── CHAT ────────────────────────────────────────────────
let CHAT_HISTORY = [];
function chatStateContext() {
  const completed = getCompleted();
  const done = Object.keys(completed).filter(k => completed[k]);
  const goals = getGoals();
  const statsText = SKILL_NAMES.slice(1).map(n => n + ' ' + STATS[n][1]).join(', ');
  return 'RSN: Nullyn Voyd. Combat ' + combatLevel() + ', Total ' + totalLevel() + '.\\n' +
         'Levels: ' + statsText + '\\n' +
         'Completed quests (' + done.length + '): ' + (done.join(', ') || 'none') + '\\n' +
         'Goals: ' + (goals.map(g => g.skill + '\\u2192' + g.target).join(', ') || 'none');
}
function appendChat(role, text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}
async function sendChat() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendChat('user', msg);
  btn.disabled = true;
  const thinking = appendChat('sys', '\\uD83E\\uDDD9 Thinking\\u2026');
  try {
    const r = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: msg, history: CHAT_HISTORY, context: chatStateContext() }) });
    if (!r.ok) throw new Error('chat ' + r.status);
    const data = await r.json();
    thinking.remove();
    appendChat('bot', data.reply);
    CHAT_HISTORY.push({ role:'user', content: msg });
    CHAT_HISTORY.push({ role:'assistant', content: data.reply });
    if (CHAT_HISTORY.length > 20) CHAT_HISTORY = CHAT_HISTORY.slice(-20);
  } catch (e) {
    thinking.textContent = '\\u26a0 Could not reach Claude. Check the server and your API key.';
  } finally {
    btn.disabled = false;
    input.focus();
  }
}
document.addEventListener('DOMContentLoaded', function () {
  const ci = document.getElementById('chat-input');
  if (ci) ci.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
});

`;
replace('// ── INIT', CHAT_JS + '// ── INIT', 'chat js');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('Wrote ' + OUT + ' (' + html.length + ' bytes)');
