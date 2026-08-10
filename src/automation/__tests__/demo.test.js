'use strict';

const fs = require('fs');
const run = require('../../../automation-scripts/demo');

describe('daily-reward built-in example script', () => {
  test('waits for and clicks the three Vision templates in order', async () => {
    const calls = [];
    const centers = {
      'entry-activity': { normalizedX: 0.2, normalizedY: 0.3 },
      'button-down': { normalizedX: 0.5, normalizedY: 0.6 },
      'try-your-luck': { normalizedX: 0.7, normalizedY: 0.8 }
    };
    await run({
      profileId: 'p_aaaaaaaa', config: {}, signal: { aborted: false }, log: { info: jest.fn() },
      automation: { click: async function (point) { calls.push(['click', point]); } },
      vision: {
        waitFor: async function (templateId, options) {
          calls.push(['waitFor', templateId, options]);
          return { center: centers[templateId] };
        }
      }
    });
    expect(calls).toEqual([
      ['waitFor', 'entry-activity', {
        roi: { x: 473, y: 1, width: 70, height: 67 },
        threshold: 0.95, timeoutMs: 10000, pollIntervalMs: 250
      }],
      ['click', centers['entry-activity']],
      ['waitFor', 'button-down', {
        roi: { x: 584, y: 668, width: 78, height: 89 },
        threshold: 0.95, timeoutMs: 10000, pollIntervalMs: 250
      }],
      ['click', centers['button-down']],
      ['waitFor', 'try-your-luck', {
        roi: { x: 491, y: 247, width: 177, height: 432 },
        threshold: 0.95, timeoutMs: 10000, pollIntervalMs: 250
      }],
      ['click', centers['try-your-luck']]
    ]);
  });

  test('uses only the injected Automation and Vision APIs', () => {
    const source = fs.readFileSync(require.resolve('../../../automation-scripts/demo'), 'utf8');
    expect(source).not.toMatch(/electron|BrowserWindow|webContents|debugger|dispatchMouseEvent/);
    expect(source).toMatch(/context\.vision\.waitFor/);
    expect(source).toMatch(/context\.automation\.click/);
  });
});
