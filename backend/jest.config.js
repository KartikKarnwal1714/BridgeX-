module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  forceExit: true,
  globalSetup: '<rootDir>/tests/globalSetup.js',
};
