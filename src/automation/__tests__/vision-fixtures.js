'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const PRODUCT_IMAGE_SIZE = Object.freeze({ width: 1920, height: 1080 });
const UNEQUAL_IMAGE_SIZE = Object.freeze({ width: 3840, height: 2160 });
const DIP_SENTINEL_SIZE = Object.freeze({ width: 960, height: 540 });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(function (resolvePromise, rejectPromise) {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise: promise, resolve: resolve, reject: reject };
}

function rgba(width, height, fill) {
  const color = fill || [0, 0, 0, 255];
  const bitmap = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    bitmap[offset] = color[0];
    bitmap[offset + 1] = color[1];
    bitmap[offset + 2] = color[2];
    bitmap[offset + 3] = color[3];
  }
  return bitmap;
}

function paint(bitmap, imageSize, rect, color) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const offset = (y * imageSize.width + x) * 4;
      bitmap[offset] = color[0];
      bitmap[offset + 1] = color[1];
      bitmap[offset + 2] = color[2];
      bitmap[offset + 3] = color[3];
    }
  }
  return bitmap;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (let index = 0; index < buffer.length; index++) {
    value ^= buffer[index];
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, bitmap) {
  if (!Buffer.isBuffer(bitmap) || bitmap.length !== width * height * 4) {
    throw new TypeError('bitmap length does not match image size');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(bitmap.slice(y * width * 4, (y + 1) * width * 4));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function frame(width, height, bitmap, contentSize, capturedAt) {
  return Object.freeze({
    png: encodePng(width, height, bitmap),
    imageSize: Object.freeze({ width: width, height: height }),
    contentSize: Object.freeze(contentSize || { width: width, height: height }),
    capturedAt: capturedAt === undefined ? 1 : capturedAt
  });
}

function captureSequence(frames) {
  let index = 0;
  const capture = jest.fn(function () {
    const current = frames[Math.min(index, frames.length - 1)];
    index += 1;
    return Promise.resolve(current);
  });
  capture.attempts = function () { return index; };
  return capture;
}

function createTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'vision-test-'));
}

function cleanup(root) {
  if (root && fs.existsSync(root)) fs.rmdirSync(root, { recursive: true });
}

module.exports = {
  DIP_SENTINEL_SIZE: DIP_SENTINEL_SIZE,
  PRODUCT_IMAGE_SIZE: PRODUCT_IMAGE_SIZE,
  UNEQUAL_IMAGE_SIZE: UNEQUAL_IMAGE_SIZE,
  captureSequence: captureSequence,
  cleanup: cleanup,
  createTempRoot: createTempRoot,
  deferred: deferred,
  encodePng: encodePng,
  frame: frame,
  paint: paint,
  rgba: rgba
};
