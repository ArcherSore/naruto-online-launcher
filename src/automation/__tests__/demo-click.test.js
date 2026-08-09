'use strict';

const run = require('../../../automation-scripts/demo-click');

describe('demo-click built-in script', () => {
  test('clicks coordinates in order with a 1000ms restricted wait', async () => {
    const calls = [];
    await run({
      profileId: 'p_aaaaaaaa', config: {}, signal: { aborted: false }, log: { info: jest.fn() },
      automation: {
        getCoordinates: async function () {
          return [
            { order: 1, normalizedX: 0.2, normalizedY: 0.3 },
            { order: 2, normalizedX: 0.7, normalizedY: 0.8 }
          ];
        },
        click: async function (point) { calls.push(['click', point]); },
        wait: async function (ms) { calls.push(['wait', ms]); }
      }
    });
    expect(calls).toEqual([
      ['click', { normalizedX: 0.2, normalizedY: 0.3 }],
      ['wait', 1000],
      ['click', { normalizedX: 0.7, normalizedY: 0.8 }]
    ]);
  });

  test('fails with coordinates-missing and never touches Electron/CDP directly', async () => {
    await expect(run({
      config: {}, signal: { aborted: false }, log: { info: jest.fn() },
      automation: { getCoordinates: async function () { return []; } }
    })).rejects.toMatchObject({ code: 'coordinates-missing' });
    const source = require('fs').readFileSync(
      require.resolve('../../../automation-scripts/demo-click'),
      'utf8'
    );
    expect(source).not.toMatch(/electron|BrowserWindow|webContents|debugger|dispatchMouseEvent/);
  });
});
