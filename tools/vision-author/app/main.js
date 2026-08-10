'use strict';

const path = require('path');
const defaultNet = require('net');
const EventEmitter = require('events');
const protocol = require('../bridge/protocol');

const IPC_OPERATIONS = Object.freeze({
  'vision-author:profiles-list': Object.freeze({ op: 'profiles.list', keys: [] }),
  'vision-author:scripts-list': Object.freeze({ op: 'scripts.list', keys: [] }),
  'vision-author:capture': Object.freeze({ op: 'capture', keys: ['profileId', 'selectionEpoch'] }),
  'vision-author:frame-displayed': Object.freeze({
    op: 'frame.displayed',
    keys: ['frameId', 'profileId', 'selectionEpoch']
  }),
  'vision-author:frame-freeze': Object.freeze({
    op: 'frame.freeze',
    keys: ['frameId', 'profileId', 'selectionEpoch']
  }),
  'vision-author:frame-release': Object.freeze({ op: 'frame.release', keys: ['frameId'] }),
  'vision-author:preview-create': Object.freeze({
    op: 'preview.create',
    keys: ['frozenFrameId', 'templateRect']
  }),
  'vision-author:save-preflight': Object.freeze({
    op: 'template.save.preflight',
    keys: ['frozenFrameId', 'previewId', 'scriptId', 'templateId']
  }),
  'vision-author:save-commit': Object.freeze({
    op: 'template.save.commit',
    keys: ['frozenFrameId', 'previewId', 'replacementGrant', 'scriptId', 'templateId']
  })
});

function createPipeClient(options) {
  const opts = options || {};
  const net = opts.net || defaultNet;
  if (typeof opts.pipeName !== 'string' || !opts.pipeName) throw new TypeError('pipeName is required');
  if (typeof opts.token !== 'string' || !/^[a-f0-9]{64}$/.test(opts.token)) {
    throw new TypeError('valid token is required');
  }
  const events = new EventEmitter();
  const pending = new Map();
  let socket = null;
  let sequence = 0;
  let connected = false;
  let closed = false;

  function rejectPending() {
    const error = protocol.safeError({ code: 'connection-closed' });
    pending.forEach(function (entry) { entry.reject(error); });
    pending.clear();
  }

  function close() {
    if (closed) return;
    closed = true;
    connected = false;
    rejectPending();
    if (socket) {
      try { socket.end(); } catch (_) { /* connection is already closed */ }
      try { socket.destroy(); } catch (_) { /* connection is already closed */ }
    }
    socket = null;
    events.emit('disconnect', protocol.safeError({ code: 'connection-closed' }));
  }

  function send(op, payload) {
    if (!socket || closed) return Promise.reject(protocol.safeError({ code: 'connection-closed' }));
    const requestId = 'request-' + (++sequence);
    const message = {
      protocolVersion: protocol.PROTOCOL_VERSION,
      type: 'request',
      requestId: requestId,
      op: op,
      payload: payload || {}
    };
    return new Promise(function (resolve, reject) {
      pending.set(requestId, { resolve: resolve, reject: reject });
      try {
        socket.write(protocol.encodeMessage(message));
      } catch (_) {
        pending.delete(requestId);
        reject(protocol.safeError({ code: 'connection-closed' }));
        close();
      }
    });
  }

  function connect() {
    if (socket || closed) return Promise.reject(protocol.safeError({ code: 'connection-closed' }));
    return new Promise(function (resolve, reject) {
      socket = net.connect(opts.pipeName);
      const decoder = protocol.createFrameDecoder({
        onMessage: function (message) {
          if (!message || message.type !== 'response' || !pending.has(message.requestId)) {
            close();
            return;
          }
          const entry = pending.get(message.requestId);
          pending.delete(message.requestId);
          if (message.ok === true) entry.resolve(message.result);
          else entry.reject(message.error || protocol.safeError({ code: 'invalid-request' }));
        }
      });
      socket.on('connect', function () {
        send('hello', { token: opts.token }).then(function (result) {
          connected = true;
          resolve(result);
        }, function (error) {
          reject(error);
          close();
        });
      });
      socket.on('data', function (chunk) {
        try { decoder.push(chunk); } catch (_) { close(); }
      });
      socket.on('error', function () {
        if (!connected) reject(protocol.safeError({ code: 'connection-closed' }));
        close();
      });
      socket.on('close', close);
    });
  }

  return Object.freeze({
    connect: connect,
    request: send,
    close: close,
    onDisconnect: function (listener) { events.on('disconnect', listener); },
    connected: function () { return connected; }
  });
}

function exactPayload(value, keys) {
  const payload = value === undefined ? {} : value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const actual = Object.keys(payload).sort();
  const allowed = keys.slice().sort();
  if (actual.some(function (key) { return allowed.indexOf(key) === -1; })) return null;
  return payload;
}

async function startAuthorApp(options) {
  const opts = options || {};
  const electron = opts.electron || require('electron');
  const pipeName = opts.pipeName || process.env.VISION_AUTHOR_PIPE;
  const token = opts.token || process.env.VISION_AUTHOR_TOKEN;
  const client = createPipeClient({ pipeName: pipeName, token: token, net: opts.net });
  await electron.app.whenReady();
  await client.connect();
  const window = new electron.BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#11131a',
    title: 'Vision Author Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      sandbox: false
    }
  });
  Object.keys(IPC_OPERATIONS).forEach(function (channel) {
    const operation = IPC_OPERATIONS[channel];
    electron.ipcMain.handle(channel, function (_event, payload) {
      const safePayload = exactPayload(payload, operation.keys);
      if (!safePayload) return Promise.reject(protocol.safeError({ code: 'invalid-request' }));
      return client.request(operation.op, safePayload);
    });
  });
  electron.ipcMain.handle('vision-author:clipboard-write', function (_event, value) {
    if (typeof value !== 'string' || value.length > 20000) {
      return Promise.reject(protocol.safeError({ code: 'invalid-request' }));
    }
    try {
      electron.clipboard.writeText(value);
      return { copied: true };
    } catch (_) {
      const safe = protocol.safeError({ code: 'clipboard-failed' });
      const error = new Error(safe.safeMessage);
      error.code = safe.code;
      error.safeMessage = safe.safeMessage;
      error.recovery = safe.recovery;
      throw error;
    }
  });
  client.onDisconnect(function (error) {
    if (!window.isDestroyed()) window.webContents.send('vision-author:disconnected', error);
  });
  window.on('closed', function () {
    client.request('session.close', {}).catch(function () {}).finally(function () {
      client.close();
      electron.app.quit();
    });
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
  window.show();
  return Object.freeze({ client: client, window: window });
}

if (require.main === module) {
  startAuthorApp().catch(function () {
    try { require('electron').app.quit(); } catch (_) { process.exitCode = 1; }
  });
}

module.exports = {
  IPC_OPERATIONS: IPC_OPERATIONS,
  createPipeClient: createPipeClient,
  startAuthorApp: startAuthorApp
};
