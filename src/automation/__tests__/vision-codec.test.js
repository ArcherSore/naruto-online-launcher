'use strict';

const { createVisionCodec, MAX_PNG_BYTES } = require('../vision/codec');
const fixtures = require('./vision-fixtures');

function nativeImageFor(image) {
  return {
    createFromBuffer: jest.fn(function () { return image; })
  };
}

describe('Vision PNG codec', () => {
  test('validates PNG/IHDR and copies a template bitmap using toBitmap', () => {
    const bitmap = fixtures.rgba(2, 2, [1, 2, 3, 4]);
    const image = {
      isEmpty: function () { return false; },
      getSize: function () { return { width: 2, height: 2 }; },
      toBitmap: jest.fn(function () { return bitmap; }),
      getBitmap: jest.fn(function () { throw new Error('tick-bound API must not be used'); })
    };
    const codec = createVisionCodec({ nativeImage: nativeImageFor(image) });
    const decoded = codec.decodeTemplate(fixtures.encodePng(2, 2, bitmap));
    expect(decoded).toEqual({ width: 2, height: 2, bitmap: bitmap });
    expect(decoded.bitmap).not.toBe(bitmap);
    expect(image.toBitmap).toHaveBeenCalledTimes(1);
    expect(image.getBitmap).not.toHaveBeenCalled();
  });

  test.each([
    [Buffer.from('not png'), 'vision-template-invalid'],
    [Buffer.alloc(MAX_PNG_BYTES + 1), 'vision-template-invalid']
  ])('classifies invalid template bytes', (bytes, code) => {
    const codec = createVisionCodec({ nativeImage: nativeImageFor(null) });
    expect(function () { codec.decodeTemplate(bytes); }).toThrow(expect.objectContaining({ code: code }));
  });

  test('rejects empty images, decoder size disagreement and bitmap length mismatch', () => {
    const png = fixtures.encodePng(2, 2, fixtures.rgba(2, 2));
    [
      { isEmpty: function () { return true; } },
      { isEmpty: function () { return false; }, getSize: function () { return { width: 3, height: 2 }; }, toBitmap: function () { return Buffer.alloc(24); } },
      { isEmpty: function () { return false; }, getSize: function () { return { width: 2, height: 2 }; }, toBitmap: function () { return Buffer.alloc(15); } }
    ].forEach(function (image) {
      const codec = createVisionCodec({ nativeImage: nativeImageFor(image) });
      expect(function () { codec.decodeTemplate(png); })
        .toThrow(expect.objectContaining({ code: 'vision-template-invalid' }));
    });
  });

  test('keeps capture PNG and metadata in one frame and maps decode failures to capture-failed', () => {
    const bitmap = fixtures.rgba(2, 2);
    const frame = fixtures.frame(2, 2, bitmap, { width: 4, height: 4 }, 42);
    const image = {
      isEmpty: function () { return false; },
      getSize: function () { return { width: 2, height: 2 }; },
      toBitmap: function () { return bitmap; }
    };
    const decoded = createVisionCodec({ nativeImage: nativeImageFor(image) }).decodeCapture(frame);
    expect(decoded.imageSize).toEqual(frame.imageSize);
    expect(decoded.contentSize).toEqual(frame.contentSize);
    expect(decoded.capturedAt).toBe(42);

    const broken = createVisionCodec({ nativeImage: nativeImageFor({ isEmpty: function () { return true; } }) });
    expect(function () { broken.decodeCapture(frame); })
      .toThrow(expect.objectContaining({ code: 'capture-failed' }));
  });
});
