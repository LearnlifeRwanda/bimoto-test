// LOOSE-ENDS G1.2 — the minimal reproduction of #170's silent-blanking
// hole, planted as a permanent fixture.
//
// `csvCell` below is the exact shape that desynchronised the tokenizer:
// a regex literal containing a double quote, sitting inside a template
// literal's ${...} expression. skipTemplateExpr had no regex branch, so
// the `"` inside `/"/g` was read as the start of a string; skipString
// then ran past the regex to the next unrelated quote and the scan lost
// its place. Everything after this function was blanked — which is how
// intel.routes.ts vanished from a GREEN audit.
//
// The endpoints below the function are therefore the assertion: if the
// tokenizer is whole, they are in the map; if it desynchronises, they
// silently are not.
const router: any = {};

export function csvCell(value: unknown): string {
  const s = String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

// A regex holding a backtick inside a ${...} expression — the mirror of
// the case above, where the mis-read delimiter is a template rather
// than a string.
export function tickCell(value: string): string {
  return `[${value.replace(/`/g, '')}]`;
}

// Nested ${} with a regex in the inner expression.
export function nested(a: string, b: string): string {
  return `${a}-${`${b.replace(/["'`]/g, '')}`}`;
}

router.get('/after-regex-in-template', () => {});
router.post('/:id/export', () => {});

export default router;
