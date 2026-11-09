// Fixture home screen: literal call, template call, glued query-suffix
// call, an UNRESOLVED dynamic call, a nav edge to /reachable/:id, and a
// KNOWINGLY PLANTED broken nav target (/nowhere matches no route),
// and a literal target that shares a prefix with the param route.
declare function apiFetch(path: string, init?: unknown): Promise<unknown>;
declare function navigate(to: string | number): void;
declare function buildPath(): string;

export function HomePage() {
  const id = '42';
  const query = '?filter=on';
  void apiFetch('/api/things/list');
  void apiFetch(`/api/things/list${query}`);
  void apiFetch(`/api/things/${id}/update`, { method: 'POST' });
  // dynamically-built path — must land in UNRESOLVED, never guessed:
  void apiFetch(buildPath());
  const go = () => {
    navigate(`/reachable/${id}`);
    navigate('/reachable/audit');
    navigate('/nowhere');
    navigate(-1);
  };
  return { go };
}
