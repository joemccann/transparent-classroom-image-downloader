const assert = require('node:assert/strict');
const test = require('node:test');

const { navigateToPage } = require('../dist/navigation.js');

test('navigateToPage uses domcontentloaded navigation and readiness signals instead of network idle', async () => {
  const calls = [];
  const page = {
    goto: async (url, options) => {
      calls.push({ type: 'goto', url, options });
    },
    waitForFunction: async (fn, options, payload) => {
      calls.push({ type: 'waitForFunction', fn: String(fn), options, payload });
    },
  };

  await navigateToPage(page, 'https://example.test/photos', {
    navigationTimeoutMs: 5_000,
    readyTimeoutMs: 4_000,
    readySelectors: ['#ready'],
    readyUrlIncludes: ['/login'],
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    type: 'goto',
    url: 'https://example.test/photos',
    options: {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    },
  });

  assert.equal(calls[1].type, 'waitForFunction');
  assert.equal(calls[1].options.timeout, 4_000);
  assert.deepEqual(calls[1].payload, {
    selectors: ['#ready'],
    urlIncludes: ['/login'],
    urlExcludes: [],
  });
  assert.match(calls[1].fn, /currentUrl\.includes/);
});
