/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/src/test/globalSetup.ts',
  setupFilesAfterEnv: ['<rootDir>/src/test/setupAfterEnv.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/database/migrations/**', '!src/test/**'],
};
