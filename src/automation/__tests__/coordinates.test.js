'use strict';

const {
  mapImagePointToNormalized,
  mapNormalizedPoint,
  validSize
} = require('../coordinates');

describe('shared automation coordinate contract', () => {
  test('keeps the current normalized to content floor semantics', () => {
    expect(mapNormalizedPoint({ normalizedX: 0.5, normalizedY: 0.5 }, { width: 101, height: 51 }))
      .toEqual({ x: 50, y: 25 });
    expect(function () {
      mapNormalizedPoint({ normalizedX: 1, normalizedY: 0 }, { width: 10, height: 10 });
    }).toThrow(expect.objectContaining({ code: 'coordinates-invalid' }));
  });

  test.each([
    [{ x: 0, y: 0 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }, { x: 0, y: 0 }],
    [{ x: 123, y: 39 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }, { x: 123, y: 39 }],
    [{ x: 1919.9, y: 1079.9 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }, { x: 1919, y: 1079 }],
    [{ x: 246, y: 78 }, { width: 3840, height: 2160 }, { width: 1920, height: 1080 }, { x: 123, y: 39 }],
    [{ x: 199.9, y: 99.9 }, { width: 200, height: 100 }, { width: 101, height: 51 }, { x: 100, y: 50 }]
  ])('encodes screenshot point %j to a reversible normalized cell midpoint',
    (imagePoint, imageSize, contentSize, expected) => {
      const normalized = mapImagePointToNormalized(imagePoint, imageSize, contentSize);
      expect(mapNormalizedPoint(normalized, contentSize)).toEqual(expected);
      expect(normalized.normalizedX).toBeGreaterThanOrEqual(0);
      expect(normalized.normalizedX).toBeLessThan(1);
      expect(normalized.normalizedY).toBeGreaterThanOrEqual(0);
      expect(normalized.normalizedY).toBeLessThan(1);
    });

  test('handles odd/even centers without accepting BrowserWindow DIP as an input', () => {
    const odd = mapImagePointToNormalized(
      { x: 12 + 5 / 2, y: 20 + 7 / 2 },
      { width: 200, height: 100 },
      { width: 101, height: 51 }
    );
    expect(mapNormalizedPoint(odd, { width: 101, height: 51 })).toEqual({ x: 7, y: 11 });
    expect(Object.keys(odd).sort()).toEqual(['normalizedX', 'normalizedY']);
    expect(validSize({ width: 960, height: 540 })).toBe(true);
  });
});
