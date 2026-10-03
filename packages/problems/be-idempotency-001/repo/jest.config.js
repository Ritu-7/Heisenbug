/** @type {import('jest').Config} */
module.exports = {
  // Tests live inside the repo (visible) and are mounted in from outside (hidden)
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 15000,
  forceExit: true,
  // Don't transform — pure CJS/CommonJS
  transform: {},
};
