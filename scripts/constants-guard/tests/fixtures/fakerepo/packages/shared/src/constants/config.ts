// Fixture. Four constants, four fates, one per rule the guard enforces.

/** Read by production code — the guard must stay silent about it. */
export const WIRED_LIMIT = 5;

/** Read by nothing at all — the fossil. */
export const DEAD_CONSTANT = 7000;

/** Read only by a test file — still dead, and the guard must say so. */
export const TEST_ONLY_CONSTANT = 42;

/** Read by nothing, but declared pending in the allowlist. */
export const PENDING_RULE = 10;

/** Named in a comment beside WIRED_LIMIT and read by no code: MENTIONED_IN_COMMENT. */
export const MENTIONED_IN_COMMENT = 3;
