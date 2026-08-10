'use strict';

const { createVisionMatcher } = require('../vision/matcher');
const fixtures = require('./vision-fixtures');

function image(width, height, fill) {
  return { imageSize: { width: width, height: height }, bitmap: fixtures.rgba(width, height, fill) };
}

function template(width, height, fill) {
  return { width: width, height: height, bitmap: fixtures.rgba(width, height, fill) };
}

describe('cooperative exact-scale Vision matcher', () => {
  test('uses four-channel SAD confidence and inclusive threshold boundaries', async () => {
    const search = image(2, 1, [0, 0, 0, 255]);
    const target = template(1, 1, [10, 0, 0, 0]);
    const confidence = 1 - 265 / (255 * 4);
    const matcher = createVisionMatcher();
    await expect(matcher.match({ image: search, template: target, threshold: confidence }))
      .resolves.toEqual({ rect: { x: 0, y: 0, width: 1, height: 1 }, confidence: confidence });
    await expect(matcher.match({ image: search, template: target, threshold: confidence + 0.0001 }))
      .resolves.toBeNull();
  });

  test('honors ROI, edges, best confidence and row-major tie break', async () => {
    const search = image(6, 4, [0, 0, 0, 255]);
    fixtures.paint(search.bitmap, search.imageSize, { x: 0, y: 0, width: 2, height: 2 }, [9, 9, 9, 255]);
    fixtures.paint(search.bitmap, search.imageSize, { x: 4, y: 2, width: 2, height: 2 }, [10, 10, 10, 255]);
    const target = template(2, 2, [10, 10, 10, 255]);
    const matcher = createVisionMatcher({ slicePixels: 3 });
    await expect(matcher.match({ image: search, template: target, threshold: 0.95 }))
      .resolves.toEqual({ rect: { x: 4, y: 2, width: 2, height: 2 }, confidence: 1 });
    await expect(matcher.match({
      image: search,
      template: target,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      threshold: 0.95
    })).resolves.toEqual(expect.objectContaining({ rect: { x: 0, y: 0, width: 2, height: 2 } }));

    const tied = image(3, 2, [10, 10, 10, 255]);
    await expect(matcher.match({ image: tied, template: template(1, 1, [10, 10, 10, 255]), threshold: 1 }))
      .resolves.toEqual({ rect: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1 });
  });

  test('rejects a template larger than the search region', async () => {
    const matcher = createVisionMatcher();
    await expect(matcher.match({
      image: image(2, 2),
      template: template(3, 1),
      threshold: 0
    })).rejects.toMatchObject({ code: 'vision-template-too-large' });
  });

  test('keeps pruning and cooperative slice boundaries deterministic for 100 runs', async () => {
    const search = image(8, 5, [1, 2, 3, 255]);
    fixtures.paint(search.bitmap, search.imageSize, { x: 6, y: 3, width: 2, height: 2 }, [4, 5, 6, 250]);
    const target = template(2, 2, [4, 5, 6, 250]);
    const yielded = jest.fn(function (resume) { setImmediate(resume); });
    const matcher = createVisionMatcher({ slicePixels: 1, schedule: yielded });
    const results = [];
    for (let index = 0; index < 100; index++) {
      results.push(await matcher.match({ image: search, template: target, threshold: 0.99 }));
    }
    results.forEach(function (result) { expect(result).toEqual(results[0]); });
    expect(results[0].rect).toEqual({ x: 6, y: 3, width: 2, height: 2 });
    expect(yielded).toHaveBeenCalled();
  });
});
