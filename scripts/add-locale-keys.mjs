#!/usr/bin/env node
// Add locale keys to en/fr/rw translation.json without disturbing the
// existing key order or formatting (2-space indent, trailing newline).
//
// Usage:  node scripts/add-locale-keys.mjs additions.json
// where additions.json is { "<lang>": { "<section>": { "<key>": "<copy>" } } }
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(process.cwd(), 'packages/client/public/locales');
const additions = JSON.parse(readFileSync(process.argv[2], 'utf8'));

for (const [lang, sections] of Object.entries(additions)) {
  const file = join(LOCALES, lang, 'translation.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  for (const [section, keys] of Object.entries(sections)) {
    doc[section] ??= {};
    for (const [key, value] of Object.entries(keys)) {
      if (doc[section][key] !== undefined && doc[section][key] !== value) {
        console.log(`  ${lang}.${section}.${key}: overwriting`);
      }
      doc[section][key] = value;
    }
  }
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${lang}: ${Object.values(sections).reduce((n, k) => n + Object.keys(k).length, 0)} keys written`);
}
