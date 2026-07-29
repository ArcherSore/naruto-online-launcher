/**
 * Coordinates the debug-only TCP server and temporary user mm.cfg change.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { FlashProbeServer, DEFAULT_PORT } = require('./FlashProbeServer');
const { MmCfgSession } = require('./mm');

let server = null;
let mmCfgSession = null;
let startResult = null;

function isEnabled(env) {
  const source = env || process.env;
  return source.SHINOBI_DEBUG === '1';
}

function resolveProbeSwfPath() {
  const candidates = [
    path.join(process.resourcesPath, 'flash-probe', 'FlashProbe.swf'),
    path.join(app.getAppPath().replace(/\.asar$/, ''), 'src', 'flash-probe', 'FlashProbe.swf'),
    path.join(__dirname, '..', 'flash-probe', 'FlashProbe.swf')
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

async function start(options) {
  if (!isEnabled()) return { enabled: false };
  if (startResult) return startResult;
  const opts = options || {};
  const port = opts.port || process.env.SHINOBI_FLASH_PROBE_PORT || DEFAULT_PORT;
  server = new FlashProbeServer({
    port: port,
    onHello: opts.onHello,
    onDisconnect: opts.onDisconnect
  });

  const address = await server.start();
  const swfPath = resolveProbeSwfPath();
  mmCfgSession = new MmCfgSession({
    stateDir: path.join(app.getPath('userData'), 'flash-probe')
  });
  try {
    mmCfgSession.recoverStaleBackup();
  } catch (_) {
    // A malformed/missing backup must not overwrite the current user file.
  }
  startResult = {
    enabled: true,
    server: address,
    swfPath: swfPath,
    mmCfgPath: null,
    configured: false
  };

  if (!fs.existsSync(swfPath)) {
    return startResult;
  }

  try {
    startResult.mmCfgPath = mmCfgSession.apply(swfPath, { port: address.port });
    startResult.configured = true;
  } catch (error) {
    startResult.error = error.message;
    return startResult;
  }
  return startResult;
}

function stop() {
  if (mmCfgSession) {
    try {
      mmCfgSession.restore();
    } catch (_) {
      // Preserve the backup/state files so a later debug run can retry recovery.
    }
    mmCfgSession = null;
  }
  const currentServer = server;
  server = null;
  startResult = null;
  return currentServer ? currentServer.stop() : Promise.resolve();
}

function getStatus() {
  return startResult;
}

module.exports = {
  isEnabled: isEnabled,
  resolveProbeSwfPath: resolveProbeSwfPath,
  start: start,
  stop: stop,
  getStatus: getStatus
};
