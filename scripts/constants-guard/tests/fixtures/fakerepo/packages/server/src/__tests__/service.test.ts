import { TEST_ONLY_CONSTANT } from '@fake/shared';
test('a constant only a test reads is not wired', () => {
  expect(TEST_ONLY_CONSTANT).toBe(42);
});
