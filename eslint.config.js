const util = require('util');
const js = require('@eslint/js');
const globals = require('globals');

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = typeof util.structuredClone === 'function'
    ? util.structuredClone
    : (value) => JSON.parse(JSON.stringify(value));
}

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      indent: ['error', 2],
      'linebreak-style': ['error', 'unix'],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      'no-process-exit': 'off'
    }
  }
];
