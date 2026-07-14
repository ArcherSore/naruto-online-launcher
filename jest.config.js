module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main.js',
    '!src/chromium/**/*.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true,
  // v4.0.1: forceExit necessário porque debug.js registra setInterval (MEM stats)
  // e app.whenReady().then() que deixam handles pendurados após os testes.
  // stop() limpa o interval, mas promises do whenReady mock podem persistir.
  forceExit: true
};
