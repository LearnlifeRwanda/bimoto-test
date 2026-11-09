#!/usr/bin/env node
// Copies non-TypeScript runtime assets (JSON config) from src/ to dist/.
// tsc only compiles .ts files; static data co-located with TS modules
// (e.g. services/mobility/tier-classification.json) must be mirrored
// manually so `__dirname`-relative reads work after compilation.
//
// Run as a postbuild step from packages/server/package.json's `build`
// script. Idempotent and recursive.

const { readdirSync, statSync, copyFileSync, mkdirSync } = require('fs');
const { join, relative, dirname } = require('path');

const SRC = join(__dirname, '..', 'src');
const DST = join(__dirname, '..', 'dist');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
for (const file of files) {
  const target = join(DST, relative(SRC, file));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
}

if (files.length > 0) {
  console.log(`[build] copied ${files.length} runtime asset(s) into dist/`);
}
