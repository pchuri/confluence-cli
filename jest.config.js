module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    'bin/**/*.js',
    '!node_modules/**'
  ],
  coverageThreshold: {
    global: {
      statements: 71,
      branches: 62,
      functions: 80,
      lines: 72
    }
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '**/tests/**/*.test.js'
  ]
};
