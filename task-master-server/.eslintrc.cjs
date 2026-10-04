module.exports = {
  root: true,
  env: { node: true, es2022: true, jest: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist', 'coverage', '.eslintrc.cjs', 'jest.config.js'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // Tests use require() with jest.resetModules() to re-import a fresh
      // module graph; allow it there.
      files: ['**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
