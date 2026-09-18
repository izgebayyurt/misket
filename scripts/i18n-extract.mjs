#!/usr/bin/env node
/**
 * Checks the two locale resource files against what the app actually calls
 * `t()` with: keys used in code but missing from `en` or `tr`, and keys
 * present in a resource file that nothing in `src/**` references any more.
 *
 * Run as `pnpm i18n:check` (part of `pnpm check`). Exits non-zero, with a
 * listing, on either kind of drift.
 *
 * How it finds "used" keys, since this is a plain scanner and not a real
 * parser:
 *   1. Every literal argument to a `t(...)` call, e.g. `t("settings.title")`
 *      or `t('settings.you.title', { ... })`.
 *   2. Every `i18nKey="..."` attribute (the `<Trans>` component).
 *   3. Any other quoted string in `src/**` that happens to look like a
 *      dotted key (`area.name` or deeper) *and* is also a real leaf key in
 *      `en/common.json`. This catches the one deliberate indirection in the
 *      codebase: `src/core/keymap.ts` hands out keys like
 *      `"keymap.openProject"` as plain data (it cannot import
 *      `react-i18next` — see CLAUDE.md), and a component later does
 *      `t(label(action))`. Rule 3 only ever *adds* candidates that already
 *      exist as real keys, so it cannot hide a genuinely missing key.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "src");
const EN_PATH = path.join(SRC, "locales", "en", "common.json");
const TR_PATH = path.join(SRC, "locales", "tr", "common.json");

/** Every `.ts`/`.tsx` file under `src`, skipping the locale JSON itself. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "locales") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Flatten a nested resource object to `{ "a.b.c": "the string" }`, leaves only. */
function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const KEY_SHAPE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;

/** i18next's plural-form suffixes (CLDR categories); see i18next's pluralResolver. */
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];

/** Strip a trailing plural suffix, if `key` has one — `"a.b_one"` → `"a.b"`. */
function pluralBase(key) {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s));
  return suffix ? key.slice(0, -suffix.length) : null;
}

/** Does `key` (a literal passed to `t(...)`) resolve against `knownKeys`? A
 * count-pluralized call passes the *base* key, which only exists in the
 * resource file suffixed (`_one`/`_other`/…), so check both. */
function resolves(key, knownKeys) {
  if (knownKeys.has(key)) return true;
  return PLURAL_SUFFIXES.some((s) => knownKeys.has(key + s));
}

function extractUsedKeys(files, knownKeys) {
  const used = new Set();
  const tCallRe = /\bt\(\s*["'`]([^"'`]+)["'`]/g;
  const transRe = /i18nKey\s*=\s*["']([^"']+)["']/g;
  const stringLiteralRe = /["']([A-Za-z][A-Za-z0-9.]*)["']/g;

  for (const file of files) {
    const text = readFileSync(file, "utf-8");
    // Skip a template-literal key built with interpolation (`` `a.b.${x}` ``,
    // matched by the plain t() regex up to the backtick): nothing to check
    // it against, and its concrete values are already listed by hand
    // wherever they are defined (e.g. the DIGEST_PHRASE_KEYS table).
    for (const m of text.matchAll(tCallRe)) if (!m[1].includes("${")) used.add(m[1]);
    for (const m of text.matchAll(transRe)) used.add(m[1]);
    for (const m of text.matchAll(stringLiteralRe)) {
      const candidate = m[1];
      if (KEY_SHAPE.test(candidate) && resolves(candidate, knownKeys)) used.add(candidate);
    }
  }
  return used;
}

function main() {
  const en = flatten(loadJson(EN_PATH));
  const tr = flatten(loadJson(TR_PATH));
  const enKeys = new Set(Object.keys(en));
  const trKeys = new Set(Object.keys(tr));

  const files = walk(SRC);
  const used = extractUsedKeys(files, enKeys);

  const missingInEn = [...used].filter((k) => !resolves(k, enKeys)).sort();
  const missingInTr = [...used].filter((k) => !resolves(k, trKeys)).sort();
  const unusedInEn = [...enKeys]
    .filter((k) => !used.has(k) && !used.has(pluralBase(k) ?? ""))
    .sort();
  // Keys `tr` has but `en` doesn't are a drift of a different kind: report
  // them as missing-in-en too, since `en` is the source of truth for shape.
  const extraInTr = [...trKeys].filter((k) => !enKeys.has(k)).sort();

  let ok = true;
  const report = (title, items, hint) => {
    if (items.length === 0) return;
    ok = false;
    console.error(`\n${title} (${items.length}):`);
    for (const item of items) console.error(`  - ${item}`);
    if (hint) console.error(`  (${hint})`);
  };

  report("Keys used in code but missing from src/locales/en/common.json", missingInEn);
  report("Keys used in code but missing from src/locales/tr/common.json", missingInTr);
  report(
    "Keys in src/locales/en/common.json that nothing in src/** references",
    unusedInEn,
    "remove them, or add the t(...) call that was supposed to use them",
  );
  report(
    "Keys in src/locales/tr/common.json that are not in en/common.json",
    extraInTr,
    "en/common.json is the source of truth for shape; add the key there first",
  );

  if (ok) {
    console.log(
      `i18n:check OK — ${enKeys.size} keys, ${used.size} referenced, both locales in sync.`,
    );
  }
  process.exit(ok ? 0 : 1);
}

main();
