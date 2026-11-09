// Fixture dead file: nothing imports it from main.tsx. Its call must
// NOT count as wiring — /api/things/dead-only stays effectively orphan
// (status: called-from-dead-code-only).
declare function apiFetch(path: string): Promise<unknown>;

export function DeadFile() {
  void apiFetch('/api/things/dead-only');
  return null;
}
