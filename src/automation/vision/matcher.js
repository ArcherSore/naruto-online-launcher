'use strict';

const { AutomationError } = require('../errors');
const { validSize } = require('../coordinates');

function validRect(rect, imageSize) {
  return !!(
    rect &&
    Number.isInteger(rect.x) && rect.x >= 0 &&
    Number.isInteger(rect.y) && rect.y >= 0 &&
    Number.isInteger(rect.width) && rect.width > 0 &&
    Number.isInteger(rect.height) && rect.height > 0 &&
    rect.x + rect.width <= imageSize.width &&
    rect.y + rect.height <= imageSize.height
  );
}

function createVisionMatcher(options) {
  const opts = options || {};
  const slicePixels = Number.isInteger(opts.slicePixels) && opts.slicePixels > 0
    ? opts.slicePixels
    : 32768;
  const sliceBudgetMs = Number.isFinite(opts.sliceBudgetMs) && opts.sliceBudgetMs > 0
    ? opts.sliceBudgetMs
    : 8;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const schedule = typeof opts.schedule === 'function'
    ? opts.schedule
    : function (resume) { setImmediate(resume); };

  function yieldToEventLoop() {
    return new Promise(function (resolve, reject) {
      try {
        schedule(resolve);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function match(input) {
    const query = input || {};
    const image = query.image;
    const template = query.template;
    if (
      !image || !validSize(image.imageSize) || !Buffer.isBuffer(image.bitmap) ||
      image.bitmap.length !== image.imageSize.width * image.imageSize.height * 4 ||
      !template || !validSize({ width: template.width, height: template.height }) ||
      !Buffer.isBuffer(template.bitmap) ||
      template.bitmap.length !== template.width * template.height * 4 ||
      !Number.isFinite(query.threshold) || query.threshold < 0 || query.threshold > 1
    ) {
      throw new AutomationError('vision-input-invalid');
    }
    const roi = query.roi || {
      x: 0,
      y: 0,
      width: image.imageSize.width,
      height: image.imageSize.height
    };
    if (!validRect(roi, image.imageSize)) throw new AutomationError('vision-input-invalid');
    if (template.width > roi.width || template.height > roi.height) {
      throw new AutomationError('vision-template-too-large');
    }
    const checkBoundary = typeof query.checkBoundary === 'function'
      ? query.checkBoundary
      : function () {};
    const templatePixels = template.width * template.height;
    const denominator = 255 * 4 * templatePixels;
    const thresholdError = Math.ceil((1 - query.threshold) * denominator);
    let bestError = Infinity;
    let bestRect = null;
    let work = 0;
    let sliceStartedAt = now();

    function checkpoint() {
      checkBoundary();
      if (work < slicePixels && now() - sliceStartedAt < sliceBudgetMs) return null;
      return yieldToEventLoop().then(function () {
        checkBoundary();
        work = 0;
        sliceStartedAt = now();
      });
    }

    checkBoundary();
    const maxX = roi.x + roi.width - template.width;
    const maxY = roi.y + roi.height - template.height;
    for (let y = roi.y; y <= maxY; y++) {
      for (let x = roi.x; x <= maxX; x++) {
        let errorSum = 0;
        const candidateLimit = Math.min(bestError, thresholdError);
        let pruned = false;
        for (let templateY = 0; templateY < template.height && !pruned; templateY++) {
          let imageOffset = ((y + templateY) * image.imageSize.width + x) * 4;
          let templateOffset = templateY * template.width * 4;
          for (let templateX = 0; templateX < template.width; templateX++) {
            errorSum += Math.abs(image.bitmap[imageOffset] - template.bitmap[templateOffset]);
            errorSum += Math.abs(image.bitmap[imageOffset + 1] - template.bitmap[templateOffset + 1]);
            errorSum += Math.abs(image.bitmap[imageOffset + 2] - template.bitmap[templateOffset + 2]);
            errorSum += Math.abs(image.bitmap[imageOffset + 3] - template.bitmap[templateOffset + 3]);
            imageOffset += 4;
            templateOffset += 4;
            work += 1;
            if (errorSum > candidateLimit) {
              pruned = true;
              break;
            }
            const pixelYield = checkpoint();
            if (pixelYield) await pixelYield;
          }
        }
        const confidence = 1 - errorSum / denominator;
        if (!pruned && confidence >= query.threshold && errorSum < bestError) {
          bestError = errorSum;
          bestRect = { x: x, y: y, width: template.width, height: template.height };
        }
        const candidateYield = checkpoint();
        if (candidateYield) await candidateYield;
      }
    }
    checkBoundary();
    if (!bestRect) return null;
    return Object.freeze({
      rect: Object.freeze(bestRect),
      confidence: Math.max(0, Math.min(1, 1 - bestError / denominator))
    });
  }

  return Object.freeze({ match: match });
}

module.exports = {
  createVisionMatcher: createVisionMatcher,
  validRect: validRect
};
