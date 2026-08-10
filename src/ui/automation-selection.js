'use strict';

const { mapImagePointToNormalized, validSize } = require('../automation/coordinates');

const EDGE_EPSILON = 0.0000001;

function finite(value) {
  return Number.isFinite(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clientPointToImage(point, metrics) {
  if (
    !point ||
    !metrics ||
    !finite(point.clientX) ||
    !finite(point.clientY) ||
    !finite(metrics.left) ||
    !finite(metrics.top) ||
    !finite(metrics.clientLeft) ||
    !finite(metrics.clientTop) ||
    !finite(metrics.clientWidth) ||
    metrics.clientWidth <= 0 ||
    !finite(metrics.clientHeight) ||
    metrics.clientHeight <= 0 ||
    !finite(metrics.naturalWidth) ||
    metrics.naturalWidth <= 0 ||
    !finite(metrics.naturalHeight) ||
    metrics.naturalHeight <= 0
  ) {
    return null;
  }
  const contentX = point.clientX - metrics.left - metrics.clientLeft;
  const contentY = point.clientY - metrics.top - metrics.clientTop;
  return Object.freeze({
    x: clamp(
      (contentX * metrics.naturalWidth) / metrics.clientWidth,
      0,
      metrics.naturalWidth - EDGE_EPSILON
    ),
    y: clamp(
      (contentY * metrics.naturalHeight) / metrics.clientHeight,
      0,
      metrics.naturalHeight - EDGE_EPSILON
    )
  });
}

function createVisionSelection(start, end, imageSize, contentSize) {
  if (
    !start ||
    !end ||
    !finite(start.x) ||
    !finite(start.y) ||
    !finite(end.x) ||
    !finite(end.y) ||
    !validSize(imageSize) ||
    !validSize(contentSize)
  ) {
    return null;
  }
  const startX = clamp(start.x, 0, imageSize.width - EDGE_EPSILON);
  const startY = clamp(start.y, 0, imageSize.height - EDGE_EPSILON);
  const endX = clamp(end.x, 0, imageSize.width - EDGE_EPSILON);
  const endY = clamp(end.y, 0, imageSize.height - EDGE_EPSILON);
  const x = Math.floor(Math.min(startX, endX));
  const y = Math.floor(Math.min(startY, endY));
  const right = Math.min(imageSize.width, Math.ceil(Math.max(startX, endX)));
  const bottom = Math.min(imageSize.height, Math.ceil(Math.max(startY, endY)));
  const roi = Object.freeze({
    x: x,
    y: y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  });
  const imageCenter = Object.freeze({
    x: roi.x + roi.width / 2,
    y: roi.y + roi.height / 2
  });
  const center = mapImagePointToNormalized(imageCenter, imageSize, contentSize);
  return Object.freeze({ roi: roi, imageCenter: imageCenter, center: center });
}

module.exports = {
  clientPointToImage: clientPointToImage,
  createVisionSelection: createVisionSelection
};
