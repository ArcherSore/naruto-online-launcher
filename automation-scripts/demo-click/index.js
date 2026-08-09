'use strict';

function scriptError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = async function run(context) {
  const points = await context.automation.getCoordinates();
  if (!Array.isArray(points) || points.length === 0) {
    throw scriptError('coordinates-missing');
  }
  for (let index = 0; index < points.length; index++) {
    if (index > 0) await context.automation.wait(1000);
    const point = points[index];
    await context.automation.click({
      normalizedX: point.normalizedX,
      normalizedY: point.normalizedY
    });
    context.log.info('demo-click-point-complete', { action: 'click', retryCount: index });
  }
};
