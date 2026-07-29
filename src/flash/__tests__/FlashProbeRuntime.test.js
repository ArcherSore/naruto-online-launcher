'use strict';

const FlashProbeRuntime = require('../FlashProbeRuntime');

describe('FlashProbe Debug 开关', () => {
  test('只有精确 SHINOBI_DEBUG=1 才启用', () => {
    expect(FlashProbeRuntime.isEnabled({})).toBe(false);
    expect(FlashProbeRuntime.isEnabled({ SHINOBI_DEBUG: 'true' })).toBe(false);
    expect(FlashProbeRuntime.isEnabled({ SHINOBI_DEBUG: '1' })).toBe(true);
  });
});
