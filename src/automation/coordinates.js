'use strict';

const { AutomationError } = require('./errors');

function validSize(size) {
  return !!(
    size &&
    Number.isInteger(size.width) &&
    size.width > 0 &&
    Number.isInteger(size.height) &&
    size.height > 0
  );
}

function validNormalizedPoint(point) {
  return !!(
    point &&
    Number.isFinite(point.normalizedX) &&
    Number.isFinite(point.normalizedY) &&
    point.normalizedX >= 0 &&
    point.normalizedX < 1 &&
    point.normalizedY >= 0 &&
    point.normalizedY < 1
  );
}

function mapNormalizedPoint(point, contentSize) {
  if (!validNormalizedPoint(point)) throw new AutomationError('coordinates-invalid');
  if (!validSize(contentSize)) throw new AutomationError('window-unavailable');
  return Object.freeze({
    x: Math.min(contentSize.width - 1, Math.floor(point.normalizedX * contentSize.width)),
    y: Math.min(contentSize.height - 1, Math.floor(point.normalizedY * contentSize.height))
  });
}

function mapImagePointToNormalized(imagePoint, imageSize, contentSize) {
  if (
    !validSize(imageSize) ||
    !validSize(contentSize) ||
    !imagePoint ||
    !Number.isFinite(imagePoint.x) ||
    !Number.isFinite(imagePoint.y) ||
    imagePoint.x < 0 ||
    imagePoint.x >= imageSize.width ||
    imagePoint.y < 0 ||
    imagePoint.y >= imageSize.height
  ) {
    throw new AutomationError('coordinates-invalid');
  }
  const contentX = Math.min(
    contentSize.width - 1,
    Math.floor((imagePoint.x * contentSize.width) / imageSize.width)
  );
  const contentY = Math.min(
    contentSize.height - 1,
    Math.floor((imagePoint.y * contentSize.height) / imageSize.height)
  );
  return Object.freeze({
    normalizedX: (contentX + 0.5) / contentSize.width,
    normalizedY: (contentY + 0.5) / contentSize.height
  });
}

module.exports = {
  mapImagePointToNormalized: mapImagePointToNormalized,
  mapNormalizedPoint: mapNormalizedPoint,
  validNormalizedPoint: validNormalizedPoint,
  validSize: validSize
};
