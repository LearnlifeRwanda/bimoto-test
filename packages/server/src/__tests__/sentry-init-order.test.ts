import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard for Sentry v8 init order.
 *
 * Sentry v8's OpenTelemetry-based auto-instrumentation only attaches
 * to modules required AFTER `Sentry.init`. The init runs from
 * `./instrument`, so `import './instrument'` must be the first
 * non-comment import in `index.ts`. If a future edit pushes another
 * import above it, the failure mode is silent — request-level spans
 * just stop appearing in the Sentry dashboard.
 */

const INDEX_TS = resolve(__dirname, '..', 'index.ts');
const EXPECTED_FIRST_IMPORT = "import './instrument';";

test('instrument is the first import in index.ts', () => {
  const source = readFileSync(INDEX_TS, 'utf8');
  const lines = source.split('\n');

  let firstCodeLine: string | undefined;
  let inBlockComment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//')) continue;
    firstCodeLine = line;
    break;
  }

  expect(firstCodeLine).toBe(EXPECTED_FIRST_IMPORT);
});
