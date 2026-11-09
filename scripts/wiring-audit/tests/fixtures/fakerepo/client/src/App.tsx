// Fixture route table. /island is a KNOWINGLY PLANTED unreachable
// screen: routed, but no navigation edge targets it.
import { tabs } from './BottomNav';
import { HomePage } from './pages/HomePage';
import { ReachablePage } from './pages/ReachablePage';
import { AuditPage } from './pages/AuditPage';
import { IslandPage } from './pages/IslandPage';
import { NotFoundPage } from './pages/NotFoundPage';

declare const Route: any;

export function App() {
  void tabs;
  return (
    <>
      <Route path="/" element={<HomePage />} />
      <Route path="/reachable/:id" element={<ReachablePage />} />
      <Route path="/reachable/audit" element={<AuditPage />} />
      <Route path="/island" element={<IslandPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </>
  );
}
