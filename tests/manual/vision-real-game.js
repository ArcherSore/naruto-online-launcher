'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, clipboard } = require('electron');

const MODES = Object.freeze(['find-click', 'waitFor', 'waitUntilGone']);
const TEMPLATE_ID = 'manual-target';
const PACKAGE_PREFIX = 'manual-vision-acceptance-';
const MAX_TEMPLATE_BYTES = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function usage() {
  return [
    'Usage:',
    '  electron.cmd tests\\manual\\vision-real-game.js <mode> --template <png> [--roi <x,y,w,h>] [options]',
    '',
    'Modes: find-click | waitFor | waitUntilGone',
    'If --roi is omitted, the harness imports a strict "--roi x,y,w,h" from the clipboard.',
    'Options: --threshold <0..1> --timeout-ms <1..60000> --poll-ms <50..10000>'
  ].join('\n');
}

function fail(message) {
  throw new Error(message + '\n' + usage());
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (index === args.length - 1 || args[index + 1].startsWith('--')) {
    fail('Missing value for ' + name);
  }
  if (args.indexOf(name, index + 1) !== -1) fail('Duplicate option ' + name);
  return args[index + 1];
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(name + ' is outside its supported range');
  }
  return parsed;
}

function parseRoi(value) {
  if (typeof value !== 'string') fail('--roi is required');
  const parts = value.split(',').map(Number);
  if (
    parts.length !== 4 ||
    !parts.every(Number.isInteger) ||
    parts[0] < 0 ||
    parts[1] < 0 ||
    parts[2] < 1 ||
    parts[3] < 1
  ) {
    fail('--roi must be x,y,width,height using non-negative integer pixels');
  }
  return Object.freeze({ x: parts[0], y: parts[1], width: parts[2], height: parts[3] });
}

function parseArguments(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  if (MODES.indexOf(mode) === -1) fail('Unknown or missing mode');
  const supported = new Set(['--template', '--roi', '--threshold', '--timeout-ms', '--poll-ms']);
  for (let index = 1; index < args.length; index += 2) {
    if (!supported.has(args[index])) fail('Unknown option ' + args[index]);
    if (index + 1 >= args.length) fail('Missing value for ' + args[index]);
  }

  const templateValue = optionValue(args, '--template');
  if (!templateValue) fail('--template is required');
  const templatePath = path.resolve(templateValue);
  let templateStat;
  try {
    templateStat = fs.lstatSync(templatePath);
  } catch (_) {
    fail('Template file is unavailable');
  }
  if (
    !templateStat.isFile() ||
    templateStat.isSymbolicLink() ||
    templateStat.size < PNG_SIGNATURE.length ||
    templateStat.size > MAX_TEMPLATE_BYTES ||
    path.extname(templatePath).toLowerCase() !== '.png'
  ) {
    fail('Template must be a regular PNG within the Vision v1 size limit');
  }
  const signature = Buffer.alloc(PNG_SIGNATURE.length);
  const descriptor = fs.openSync(templatePath, 'r');
  try {
    fs.readSync(descriptor, signature, 0, signature.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (!signature.equals(PNG_SIGNATURE)) fail('Template does not have a PNG signature');

  const thresholdValue = optionValue(args, '--threshold');
  const threshold = thresholdValue === null ? 0.95 : Number(thresholdValue);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fail('--threshold must be between 0 and 1');
  }
  const timeoutValue = optionValue(args, '--timeout-ms');
  const pollValue = optionValue(args, '--poll-ms');
  const timeoutMs = timeoutValue === null
    ? 15000
    : parseInteger(timeoutValue, '--timeout-ms', 1, 60000);
  const pollIntervalMs = pollValue === null
    ? 250
    : parseInteger(pollValue, '--poll-ms', 50, 10000);
  if (pollIntervalMs > timeoutMs) fail('--poll-ms cannot exceed --timeout-ms');

  let roiValue = optionValue(args, '--roi');
  if (roiValue === null) {
    let clipboardText = '';
    try {
      clipboardText = clipboard.readText().trim();
    } catch (_) {
      clipboardText = '';
    }
    const clipboardMatch = /^--roi\s+(\d+,\d+,\d+,\d+)$/.exec(clipboardText);
    roiValue = clipboardMatch ? clipboardMatch[1] : null;
  }

  return Object.freeze({
    mode: mode,
    templatePath: templatePath,
    options: Object.freeze({
      roi: parseRoi(roiValue),
      threshold: threshold,
      timeoutMs: timeoutMs,
      pollIntervalMs: pollIntervalMs
    })
  });
}

function makeEntrySource(config) {
  const findOptions = {
    roi: config.options.roi,
    threshold: config.options.threshold
  };
  const waitOptions = Object.assign({}, findOptions, {
    timeoutMs: config.options.timeoutMs,
    pollIntervalMs: config.options.pollIntervalMs
  });
  return [
    "'use strict';",
    '',
    'module.exports = async function run(context) {',
    '  const templateId = ' + JSON.stringify(TEMPLATE_ID) + ';',
    '  const mode = ' + JSON.stringify(config.mode) + ';',
    '  let result;',
    "  if (mode === 'find-click') {",
    '    result = await context.vision.find(templateId, ' + JSON.stringify(findOptions) + ');',
    "    if (!result) { const error = new Error('vision-no-match'); error.code = 'script-failed'; throw error; }",
    "    console.log('VISION_MANUAL_RESULT ' + JSON.stringify({ mode: mode, templateId: templateId, rect: result.rect, confidence: result.confidence, center: result.center }));",
    '    await context.automation.click(result.center);',
    "    console.log('VISION_MANUAL_CLICK dispatched');",
    "  } else if (mode === 'waitFor') {",
    '    result = await context.vision.waitFor(templateId, ' + JSON.stringify(waitOptions) + ');',
    "    console.log('VISION_MANUAL_RESULT ' + JSON.stringify({ mode: mode, templateId: templateId, rect: result.rect, confidence: result.confidence, center: result.center }));",
    '  } else {',
    '    result = await context.vision.waitUntilGone(templateId, ' + JSON.stringify(waitOptions) + ');',
    "    console.log('VISION_MANUAL_RESULT ' + JSON.stringify({ mode: mode, templateId: templateId, gone: result }));",
    '  }',
    '};',
    ''
  ].join('\n');
}

const config = parseArguments(process.argv);
const repositoryRoot = path.resolve(__dirname, '..', '..');
const scriptsRoot = path.join(repositoryRoot, 'automation-scripts');
const scriptId = PACKAGE_PREFIX + crypto.randomBytes(6).toString('hex');
const packageRoot = path.join(scriptsRoot, scriptId);
const stagingSmoke = process.env.VISION_MANUAL_HARNESS_SMOKE === '1';
let cleaned = false;
let unsubscribeStatus = null;

app.setAppPath(repositoryRoot);

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (typeof unsubscribeStatus === 'function') unsubscribeStatus();
  const relative = path.relative(scriptsRoot, packageRoot);
  if (
    relative === scriptId &&
    scriptId.startsWith(PACKAGE_PREFIX) &&
    path.dirname(packageRoot) === scriptsRoot &&
    fs.existsSync(packageRoot)
  ) {
    fs.rmdirSync(packageRoot, { recursive: true });
  }
  process.stdout.write('VISION_MANUAL_CLEANUP ' + scriptId + '\n');
}

function stagePackage() {
  const visionRoot = path.join(packageRoot, 'assets', 'vision');
  fs.mkdirSync(visionRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: scriptId,
    name: 'Vision 手动验收：' + config.mode,
    version: '0.0.0-manual',
    entry: 'index.js',
    apiVersion: 1,
    description: '仅当前开发验收会话使用；运行结束后自动删除。'
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'index.js'), makeEntrySource(config), 'utf8');
  fs.copyFileSync(config.templatePath, path.join(visionRoot, TEMPLATE_ID + '.png'));
}

function observeService(service) {
  const registered = service.listCatalog().some(function (script) { return script.id === scriptId; });
  if (!registered) throw new Error('Temporary manual script was not registered');
  unsubscribeStatus = service.onStatus(function (status) {
    if (!status || status.scriptId !== scriptId) return;
    process.stdout.write('VISION_MANUAL_STATUS ' + JSON.stringify({
      profileId: status.profileId,
      status: status.status,
      errorCode: status.error ? status.error.code : null
    }) + '\n');
    if (status.status === 'succeeded' || status.status === 'failed') cleanup();
  });
  process.stdout.write(
    'VISION_MANUAL_READY ' + JSON.stringify({ scriptId: scriptId, mode: config.mode }) + '\n'
  );
  process.stdout.write('Open the target Profile automation panel and press Start for this script.\n');
  if (stagingSmoke) {
    setImmediate(function () {
      cleanup();
      try {
        require('../../src/flash/mms').restoreMmsCfg();
      } catch (_) {
        // The smoke has already verified package cleanup; do not mask that result.
      }
      process.exit(0);
    });
  }
}

function fatal(error) {
  const message = error && error.message ? error.message : 'manual harness failed';
  process.stderr.write('VISION_MANUAL_ERROR ' + message + '\n');
  cleanup();
  app.exit(1);
}

try {
  stagePackage();
  process.once('exit', cleanup);
  app.once('will-quit', cleanup);

  const automationModule = require('../../src/automation');
  const originalCreateAutomationService = automationModule.createAutomationService;
  automationModule.createAutomationService = function createObservedAutomationService(options) {
    automationModule.createAutomationService = originalCreateAutomationService;
    const service = originalCreateAutomationService(options);
    observeService(service);
    return service;
  };

  const settingsModule = require('../../src/config/settings');
  const originalLoadConfig = settingsModule.loadConfig;
  settingsModule.loadConfig = function loadManualAcceptanceConfig() {
    return Object.assign({}, originalLoadConfig(), { firstBoot: false });
  };
  try {
    require('../../src/main');
  } finally {
    settingsModule.loadConfig = originalLoadConfig;
  }
} catch (error) {
  fatal(error);
}

process.once('uncaughtException', fatal);
process.once('unhandledRejection', fatal);
