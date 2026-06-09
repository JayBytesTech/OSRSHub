'use strict';

/**
 * sync-docs.js — push the canonical repo docs/ into the Obsidian vault.
 *
 * The repo `docs/` folder is the source of truth. This script reads those files,
 * transforms them into Obsidian-flavoured notes (adds frontmatter, rewrites the
 * relative markdown cross-links into [[wiki-links]]), and writes them into the
 * vault under DOCS_SUBPATH. Vault copies are GENERATED — don't hand-edit them.
 *
 *   npm run sync-docs
 *
 * Requires VAULT_PATH (from .env, same var the app uses). Override the vault
 * sub-folder with DOCS_VAULT_SUBPATH if you move the notes.
 */

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

// Minimal .env loader so this utility runs without `npm install` (only needs VAULT_PATH).
function loadEnv() {
  if (process.env.VAULT_PATH) return;
  try {
    const txt = fsSync.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — VAULT_PATH may still come from the real environment */ }
}
loadEnv();

const VAULT_PATH = process.env.VAULT_PATH;
const DOCS_SUBPATH = process.env.DOCS_VAULT_SUBPATH || 'Gaming/OSRS/Hub Docs';
const REPO_DOCS = path.join(__dirname, '..', 'docs');

// repo file (relative to docs/) → vault note name + frontmatter tags
const DOCS = [
  { repo: 'README.md',                              vault: 'OSRS Hub — Docs Index.md',                    tags: ['osrs', 'osrs-hub', 'planning'] },
  { repo: 'PRD.md',                                 vault: 'OSRS Hub — PRD.md',                           tags: ['osrs', 'osrs-hub', 'planning', 'prd'] },
  { repo: 'ROADMAP.md',                             vault: 'OSRS Hub — Roadmap.md',                       tags: ['osrs', 'osrs-hub', 'planning', 'roadmap'] },
  { repo: 'ARCHITECTURE.md',                        vault: 'OSRS Hub — Architecture.md',                  tags: ['osrs', 'osrs-hub', 'planning', 'architecture'] },
  { repo: 'GUARDRAILS.md',                          vault: 'OSRS Hub — Guardrails.md',                    tags: ['osrs', 'osrs-hub', 'planning', 'guardrails'] },
  { repo: 'decisions/0001-foundational-decisions.md', vault: 'OSRS Hub — ADR 0001 Foundational Decisions.md', tags: ['osrs', 'osrs-hub', 'planning', 'adr'] },
];

// Normalised link target (no leading ./, no trailing /) → vault wiki-link.
const LINK_MAP = {
  'README.md': '[[OSRS Hub — Docs Index]]',
  'PRD.md': '[[OSRS Hub — PRD]]',
  'ROADMAP.md': '[[OSRS Hub — Roadmap]]',
  'ARCHITECTURE.md': '[[OSRS Hub — Architecture]]',
  'GUARDRAILS.md': '[[OSRS Hub — Guardrails]]',
  'decisions': '[[OSRS Hub — ADR 0001 Foundational Decisions]]',
  'decisions/0001-foundational-decisions.md': '[[OSRS Hub — ADR 0001 Foundational Decisions]]',
};

// Plain text / inline-code references that have a nicer vault equivalent.
const EXTRA_REPLACEMENTS = [
  [/`ideas\.md`/g, '[[OSRS Hub Ideas]]'],
  [/\bideas\.md\b/g, '[[OSRS Hub Ideas]]'],
];

function frontmatter(doc) {
  return [
    '---',
    `tags: [${doc.tags.join(', ')}]`,
    `note: Generated from docs/${doc.repo} by scripts/sync-docs.js — edit the repo copy and run \`npm run sync-docs\`. Manual edits here will be overwritten.`,
    '---',
    '',
    '',
  ].join('\n');
}

function rewriteLinks(md) {
  // [text](target) → [[Vault Note]] when target is a known doc; leave http(s) and unknown links alone.
  let out = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, _text, url) => {
    if (/^https?:/i.test(url)) return whole;
    const key = url.replace(/^\.\//, '').replace(/\/$/, '');
    return LINK_MAP[key] || whole;
  });
  for (const [re, to] of EXTRA_REPLACEMENTS) out = out.replace(re, to);
  return out;
}

async function main() {
  if (!VAULT_PATH) {
    console.error('✖ VAULT_PATH is not set. Add it to .env (copy .env.example) and retry.');
    process.exit(1);
  }
  try {
    const st = await fs.stat(VAULT_PATH);
    if (!st.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`✖ VAULT_PATH does not exist or is not a directory:\n    ${VAULT_PATH}\n  Fix it in .env and retry.`);
    process.exit(1);
  }

  const destDir = path.join(VAULT_PATH, DOCS_SUBPATH);
  await fs.mkdir(destDir, { recursive: true });

  let n = 0;
  for (const doc of DOCS) {
    const srcPath = path.join(REPO_DOCS, doc.repo);
    let body;
    try {
      body = await fs.readFile(srcPath, 'utf8');
    } catch (e) {
      console.error(`  ⚠ skipped ${doc.repo} (${e.code || e.message})`);
      continue;
    }
    const content = frontmatter(doc) + rewriteLinks(body);
    await fs.writeFile(path.join(destDir, doc.vault), content, 'utf8');
    console.log(`  ✓ ${doc.repo} → ${path.join(DOCS_SUBPATH, doc.vault)}`);
    n++;
  }
  console.log(`\nSynced ${n} doc${n === 1 ? '' : 's'} → ${destDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
