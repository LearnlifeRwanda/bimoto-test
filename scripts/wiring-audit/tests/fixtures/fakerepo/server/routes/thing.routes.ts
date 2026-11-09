// Fixture router: a wired endpoint, a KNOWINGLY PLANTED orphan, a
// param route, a dead-code-only route, and a dynamic path the
// extractor must refuse to guess (UNRESOLVED).
const router: any = {};
const DYNAMIC_PATH = '/computed/' + Math.round(1);

router.get('/list', () => {});
// planted orphan — no fixture client file calls this:
router.get('/orphan', () => {});
router.post(
  '/:id/update',
  () => {},
);
router.get('/dead-only', () => {});
router.get(DYNAMIC_PATH, () => {});

export default router;
