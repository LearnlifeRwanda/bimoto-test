// CUTGUARD v2 G4 — where rule 3 looks. Shared by check.ts and census3.ts
// so the guard and the census can never disagree about their scope.
export { findRule3, runRule3, loadRule3Allowlist, describeRule3, rule3Key } from './rule3';
export type { Rule3Finding, Rule3AllowlistEntry } from './rule3';

export const ROUTE_DIRS = ['packages/server/src/routes'];
