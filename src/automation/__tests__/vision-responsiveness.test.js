'use strict';

const { AutomationError } = require('../errors');
const { createVisionMatcher } = require('../vision/matcher');
const fixtures = require('./vision-fixtures');

describe('Vision matcher event-loop responsiveness', () => {
  test('lets heartbeat and unrelated Profile work advance during a large no-match', async () => {
    const imageSize = { width: 800, height: 500 };
    const image = { imageSize: imageSize, bitmap: fixtures.rgba(imageSize.width, imageSize.height) };
    const template = { width: 2, height: 2, bitmap: fixtures.rgba(2, 2, [255, 255, 255, 255]) };
    const matcher = createVisionMatcher({ slicePixels: 256 });
    let heartbeats = 0;
    let otherProfileAdvanced = false;
    const heartbeat = setInterval(function () { heartbeats += 1; }, 1);
    const other = new Promise(function (resolve) {
      setImmediate(function () { otherProfileAdvanced = true; resolve(); });
    });
    try {
      await Promise.all([
        matcher.match({ image: image, template: template, threshold: 1 }),
        other
      ]);
    } finally {
      clearInterval(heartbeat);
    }
    expect(otherProfileAdvanced).toBe(true);
    expect(heartbeats).toBeGreaterThan(0);
  });

  test('observes cancellation during a large scan without a per-slice realtime assertion', async () => {
    const imageSize = { width: 800, height: 500 };
    const image = { imageSize: imageSize, bitmap: fixtures.rgba(imageSize.width, imageSize.height) };
    const template = { width: 2, height: 2, bitmap: fixtures.rgba(2, 2, [255, 255, 255, 255]) };
    let cancelled = false;
    setTimeout(function () { cancelled = true; }, 5);
    const startedAt = Date.now();
    await expect(createVisionMatcher({ slicePixels: 256 }).match({
      image: image,
      template: template,
      threshold: 1,
      checkBoundary: function () {
        if (cancelled) throw new AutomationError('run-cancelled');
      }
    })).rejects.toMatchObject({ code: 'run-cancelled' });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
