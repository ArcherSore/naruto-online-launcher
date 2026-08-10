'use strict';

module.exports = async function run(context) {
  const entryActivity = await context.vision.waitFor('entry-activity', {
    roi: { x: 473, y: 1, width: 70, height: 67 },
    threshold: 0.95,
    timeoutMs: 10000,
    pollIntervalMs: 250
  });
  await context.automation.click(entryActivity.center);

  const buttonDown = await context.vision.waitFor('button-down', {
    roi: { x: 584, y: 668, width: 78, height: 89 },
    threshold: 0.95,
    timeoutMs: 10000,
    pollIntervalMs: 250
  });
  await context.automation.click(buttonDown.center);

  const tryYourLuck = await context.vision.waitFor('try-your-luck', {
    roi: { x: 491, y: 247, width: 177, height: 432 },
    threshold: 0.95,
    timeoutMs: 10000,
    pollIntervalMs: 250
  });
  await context.automation.click(tryYourLuck.center);
};
