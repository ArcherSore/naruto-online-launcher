'use strict';

describe('ROI and Vision API output generation', () => {
  test('formats exact ROI and find()/waitFor() with existing API defaults', () => {
    const { formatRoi, generateVisionExamples } = require('../app/app');
    const roi = { x: 1400, y: 760, width: 480, height: 260 };
    expect(formatRoi(roi)).toBe('{ x: 1400, y: 760, width: 480, height: 260 }');
    const examples = generateVisionExamples('battle-button', roi);
    expect(examples.find).toContain('context.vision.find("battle-button"');
    expect(examples.find).toContain('roi: { x: 1400, y: 760, width: 480, height: 260 }');
    expect(examples.find).toContain('threshold: 0.95');
    expect(examples.waitFor).toContain('context.vision.waitFor("battle-button"');
    expect(examples.waitFor).toContain('timeoutMs: 10000');
    expect(examples.waitFor).toContain('pollIntervalMs: 250');
  });

  test('omits ROI when absent and uses a safe JavaScript string literal', () => {
    const { generateVisionExamples } = require('../app/app');
    const examples = generateVisionExamples('safe-template-1', null);
    expect(examples.find).not.toContain('roi:');
    expect(examples.waitFor).not.toContain('roi:');
    expect(examples.find).toContain(JSON.stringify('safe-template-1'));
    expect(function () { generateVisionExamples('../unsafe', null); }).toThrow(
      expect.objectContaining({ code: 'template-id-invalid' })
    );
  });

  test('clipboard failure leaves generated text and authoring state unchanged', async () => {
    const { copyTextSafely } = require('../app/app');
    const state = Object.freeze({ text: 'keep me', previewId: 'preview-a' });
    const bridge = { copyText: jest.fn(async function () { throw { code: 'clipboard-failed', safeMessage: '失败', recovery: '手工复制' }; }) };
    await expect(copyTextSafely(bridge, state.text)).rejects.toMatchObject({ code: 'clipboard-failed' });
    expect(state).toEqual({ text: 'keep me', previewId: 'preview-a' });
    expect(bridge.copyText).toHaveBeenCalledWith('keep me');
  });
});
