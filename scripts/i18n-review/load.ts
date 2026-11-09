// I18N-TRUTH — the one place that turns a checkout into a Model.
// Shared by the generator CLI and the CI guard so they can never read a
// different set of inputs and reach a different answer.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSources } from './sources';
import { buildModel, type Baseline, type Classification, type Model, type Notes } from './generate';

export interface Inputs {
  root: string;
  notes: Notes;
  classification: Classification;
  baseline: Baseline;
  model: Model;
}

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function loadInputs(root: string = REPO_ROOT, manifestDir: string = __dirname): Inputs {
  const notes = readJson<Notes>(path.join(manifestDir, 'notes.json'));
  const classification = readJson<Classification>(path.join(manifestDir, 'classification.json'));
  const baseline = readJson<Baseline>(path.join(manifestDir, 'baseline.json'));
  const sources = loadSources(root);
  return { root, notes, classification, baseline, model: buildModel(sources, notes, classification, baseline) };
}

/** The file's current bytes, or null when it does not exist yet. */
export function readIfPresent(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
