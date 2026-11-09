// Fixture: a LITERAL sibling of the param route /reachable/:id,
// declared AFTER it. Its only inbound edge is the literal Link on
// HomePage. React Router ranks the literal above the param, so this
// screen is reachable — the extractor must agree.
export function AuditPage() {
  return null;
}
