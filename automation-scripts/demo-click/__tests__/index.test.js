'use strict';

const DemoClickScript = require('../index');

function createApi(points, sizes) {
  let now = 5000;
  let sizeIndex = 0;
  const clicks = [];
  const sleep = jest.fn(function (ms) {
    now += ms;
    return Promise.resolve();
  });
  const api = {
    loadCoordinates: jest.fn(() => Promise.resolve({ points: points })),
    getContentSize: jest.fn(function () {
      const size = sizes[Math.min(sizeIndex, sizes.length - 1)];
      sizeIndex += 1;
      return Promise.resolve(size);
    }),
    clickContent: jest.fn(function (x, y) {
      clicks.push({ x: x, y: y, at: now });
      return Promise.resolve({ dispatchedAt: now, evidence: {} });
    }),
    sleep: sleep,
    now: jest.fn(() => now)
  };
  return { api: api, clicks: clicks, sleep: sleep };
}

describe('automation-scripts/demo-click', () => {
  test('一个坐标立即点击一次，不等待', async () => {
    const fixture = createApi(
      [{ order: 1, normalizedX: 0.25, normalizedY: 0.5 }],
      [{ width: 1000, height: 600 }]
    );

    const result = await DemoClickScript.run(fixture.api);

    expect(result.pointCount).toBe(1);
    expect(fixture.clicks).toEqual([{ x: 250, y: 300, at: 5000 }]);
    expect(fixture.sleep).not.toHaveBeenCalled();
  });

  test('两个坐标按记录顺序执行，按各次运行时尺寸映射且间隔 1000 ms', async () => {
    const fixture = createApi(
      [
        { order: 1, normalizedX: 0.25, normalizedY: 0.5 },
        { order: 2, normalizedX: 0.75, normalizedY: 0.25 }
      ],
      [
        { width: 1000, height: 600 },
        { width: 1200, height: 800 }
      ]
    );

    const result = await DemoClickScript.run(fixture.api);

    expect(result.pointCount).toBe(2);
    expect(fixture.clicks).toEqual([
      { x: 250, y: 300, at: 5000 },
      { x: 900, y: 200, at: 6000 }
    ]);
    expect(fixture.sleep).toHaveBeenCalledWith(1000);
    expect(result.clicks[1].dispatchedAt - result.clicks[0].dispatchedAt).toBe(1000);
  });

  test('没有坐标时拒绝 Run，API 不暴露任意窗口或 CDP 能力', async () => {
    const fixture = createApi([], [{ width: 100, height: 100 }]);
    await expect(DemoClickScript.run(fixture.api)).rejects.toMatchObject({
      code: 'recording-empty'
    });
    expect(Object.keys(fixture.api).sort()).toEqual([
      'clickContent',
      'getContentSize',
      'loadCoordinates',
      'now',
      'sleep'
    ]);
  });
});
