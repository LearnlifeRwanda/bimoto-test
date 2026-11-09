module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // R3-DRIVER-SCREENER — shared has no test runner of its own, so the
  // server's jest discovers shared tests too. Adding shared/src to roots
  // is the smallest change that lets us colocate eligibility tests with
  // the shared module without introducing a new test dependency.
  roots: ['<rootDir>/src', '<rootDir>/../shared/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@bimoto/shared$': '<rootDir>/../shared/src/index',
    // ts-jest reads @bimoto/shared from source, so it sees `.js`
    // import specifiers that haven't been compiled yet. Strip the
    // extension so Jest's resolver can find the matching `.ts` file.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
