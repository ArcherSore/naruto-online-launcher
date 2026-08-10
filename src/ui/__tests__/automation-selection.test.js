'use strict';

const {
  clientPointToImage,
  createVisionSelection
} = require('../automation-selection');

describe('automation screenshot selection geometry', () => {
  test('maps the image content box without treating its CSS border as screenshot pixels', () => {
    const metrics = {
      left: 100,
      top: 50,
      clientLeft: 1,
      clientTop: 1,
      clientWidth: 720,
      clientHeight: 405,
      naturalWidth: 1920,
      naturalHeight: 1080
    };

    expect(clientPointToImage({ clientX: 461, clientY: 253.5 }, metrics))
      .toEqual({ x: 960, y: 540 });
    expect(clientPointToImage({ clientX: 100, clientY: 50 }, metrics))
      .toEqual({ x: 0, y: 0 });
    const bottomRight = clientPointToImage({ clientX: 900, clientY: 600 }, metrics);
    expect(bottomRight.x).toBeGreaterThan(1919);
    expect(bottomRight.x).toBeLessThan(1920);
    expect(bottomRight.y).toBeGreaterThan(1079);
    expect(bottomRight.y).toBeLessThan(1080);
  });

  test('creates an integer screenshot ROI and a click-compatible normalized center', () => {
    const selection = createVisionSelection(
      { x: 260.1, y: 280.2 },
      { x: 100.2, y: 200.8 },
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    );

    expect(selection.roi).toEqual({ x: 100, y: 200, width: 161, height: 81 });
    expect(selection.imageCenter).toEqual({ x: 180.5, y: 240.5 });
    expect(selection.center).toEqual({
      normalizedX: 180.5 / 1920,
      normalizedY: 240.5 / 1080
    });
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.roi)).toBe(true);
  });

  test('clamps a drag to the screenshot and rejects invalid geometry', () => {
    const selection = createVisionSelection(
      { x: -20, y: -30 },
      { x: 2000, y: 1200 },
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    );
    expect(selection.roi).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(createVisionSelection(null, { x: 1, y: 1 },
      { width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(null);
  });
});
