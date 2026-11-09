// EXPORT-AND-LEDGER G6(a) — the mock-drift class, closed at its shape
// rather than at its latest instance.
//
// THE INSTANCE. soundness.test.ts mocked notification.service as `{}`.
// NOTIFY (#200) then added a notifyEscrowRefunded call to cancelJourney
// (journey.service.ts:1910), which that file exercises — and an empty
// object has no such property, so three tests died on
// "notifyEscrowRefunded is not a function". The failure is
// ORDERING-SENSITIVE (the file passes inside a full `pnpm test:server`
// run and fails on its own, because a `virtual: true` mock does not
// always win against a real module another file in the same worker has
// already resolved), which is what let it sit on main looking green.
// An environment-sensitive red is still red.
//
// THE CLASS is not "one file used {}". It is: a hand-written mock of a
// notification module is a list of function names that some OTHER file
// keeps growing. Enumerating the functions a path calls today is a
// correct mock exactly until somebody adds a call, and the failure then
// surfaces in a file whose subject has nothing to do with notifications
// — #181's lesson, and #200 proved it again by adding one call.
//
// So the shape is: EVERY property resolves to a jest.fn(), whether or not
// anybody thought of it. A notify* added tomorrow to a path under test is
// stubbed by construction, and the test still fails honestly if the thing
// it is actually testing breaks.
//
// A site that ASSERTS on a specific helper still passes its own jest.fn()
// through `overrides`; those win. The auto-stub is the floor beneath
// them, not a replacement for them — a test that wants to know
// notifyRideNotStarted fired keeps saying so, and simply stops caring
// about the twenty-two helpers it does not mention.
//
// Deliberately NOT jest's automock (`jest.mock(path)` with no factory):
// automock introspects the REAL module to learn its exports, which means
// loading notification.service and everything it imports — config,
// firebase-admin, the push stack. The whole reason these sites hand-write
// a factory is to avoid that. This keeps the avoidance and drops the
// hand-writing.

/**
 * A module stand-in whose every export is a jest.fn(), with named
 * overrides taking precedence.
 *
 * Use it INSIDE a jest.mock factory, via require — factories are hoisted
 * above imports, so an imported binding is out of scope there:
 *
 *   jest.mock('../services/notification.service', () =>
 *     require('./helpers/notification-service-mock').autoStubbedModule({
 *       notifyRideNotStarted: jest.fn(),
 *     }),
 *   );
 */
export function autoStubbedModule(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const generated = new Map<string, jest.Mock>();

  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      // Symbols and `then` must stay undefined. A module object that
      // answers to `then` is thenable, and an `await import()` or a
      // promise resolution anywhere near it would try to call it.
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (prop === '__esModule') return true;
      if (prop in overrides) return overrides[prop];
      if (!generated.has(prop)) generated.set(prop, jest.fn());
      return generated.get(prop);
    },
    has(_target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return false;
      return true;
    },
    ownKeys() {
      return [...new Set([...Object.keys(overrides), ...generated.keys()])];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      return { enumerable: true, configurable: true, writable: true, value: undefined };
    },
  });
}
