'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const visionFixtures = require('../../../src/automation/__tests__/vision-fixtures');

const PRODUCT_SIZE = Object.freeze({ width: 1920, height: 1080 });

function deferred() {
  return visionFixtures.deferred();
}

function encodeMessage(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

function makeBitmap(width, height) {
  const bitmap = visionFixtures.rgba(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      bitmap[offset] = x % 251;
      bitmap[offset + 1] = y % 241;
      bitmap[offset + 2] = (x + y) % 239;
      bitmap[offset + 3] = 255;
    }
  }
  return bitmap;
}

function createFrame(options) {
  const opts = options || {};
  const imageSize = opts.imageSize || PRODUCT_SIZE;
  const bitmap = opts.bitmap || makeBitmap(imageSize.width, imageSize.height);
  const frame = visionFixtures.frame(
    imageSize.width,
    imageSize.height,
    bitmap,
    opts.contentSize || PRODUCT_SIZE,
    opts.capturedAt === undefined ? 1000 : opts.capturedAt
  );
  return Object.freeze(
    Object.assign({}, frame, {
      profile: Object.freeze(opts.profile || { id: 'p_aaaaaaaa', name: '测试账号' })
    })
  );
}

function createTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'vision-author-'));
}

function createScriptPackage(root, options) {
  const opts = options || {};
  const scriptsRoot = path.join(root, 'automation-scripts');
  const directoryName = opts.directoryName || 'trusted-package';
  const packageRoot = path.join(scriptsRoot, directoryName);
  fs.mkdirSync(packageRoot, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    id: opts.id || 'trusted-script',
    name: opts.name || '可信脚本',
    version: '1.0.0',
    entry: 'index.js',
    apiVersion: 1,
    description: opts.description === undefined ? null : opts.description
  };
  if (manifest.description === null) delete manifest.description;
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'index.js'), "'use strict';\nmodule.exports = async function () {};\n", 'utf8');
  return Object.freeze({ scriptsRoot: scriptsRoot, packageRoot: packageRoot, manifest: manifest });
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function decodeFixturePng(png) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.slice(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  const rows = zlib.inflateSync(Buffer.concat(idat));
  const bitmap = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    if (rows[y * (stride + 1)] !== 0) throw new Error('fixture only supports filter 0');
    rows.copy(bitmap, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width: width, height: height, bitmap: bitmap };
}

function createNativeImageFixture() {
  function imageFromBitmap(width, height, bitmap) {
    return {
      isEmpty: function () { return width <= 0 || height <= 0; },
      getSize: function () { return { width: width, height: height }; },
      toBitmap: function () { return Buffer.from(bitmap); },
      toPNG: function () { return visionFixtures.encodePng(width, height, bitmap); },
      crop: function (rect) {
        const output = Buffer.alloc(rect.width * rect.height * 4);
        for (let y = 0; y < rect.height; y++) {
          const sourceStart = ((rect.y + y) * width + rect.x) * 4;
          const targetStart = y * rect.width * 4;
          bitmap.copy(output, targetStart, sourceStart, sourceStart + rect.width * 4);
        }
        return imageFromBitmap(rect.width, rect.height, output);
      }
    };
  }
  return {
    createFromBuffer: function (png) {
      const decoded = decodeFixturePng(png);
      return imageFromBitmap(decoded.width, decoded.height, decoded.bitmap);
    }
  };
}

function cleanup(root) {
  if (!root || !fs.existsSync(root)) return;
  fs.rmdirSync(root, { recursive: true });
}

module.exports = {
  PRODUCT_SIZE: PRODUCT_SIZE,
  cleanup: cleanup,
  createFrame: createFrame,
  createNativeImageFixture: createNativeImageFixture,
  createScriptPackage: createScriptPackage,
  createTempRoot: createTempRoot,
  deferred: deferred,
  decodeFixturePng: decodeFixturePng,
  encodeMessage: encodeMessage,
  makeBitmap: makeBitmap,
  randomToken: randomToken,
  visionFixtures: visionFixtures
};
