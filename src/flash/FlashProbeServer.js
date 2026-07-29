/**
 * Debug-only loopback TCP transport for FlashProbe.swf.
 */

'use strict';

const net = require('net');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 32145;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const POLICY_REQUEST = '<policy-file-request/>';

function createError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw createError('invalid-probe-port');
  }
  return port;
}

class ProbeConnection {
  constructor(socket, options) {
    this.socket = socket;
    this.maxMessageBytes = options.maxMessageBytes;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.onHello = options.onHello;
    this.onDisconnect = options.onDisconnect;
    this.buffer = Buffer.alloc(0);
    this.hello = null;
    this.closed = false;
    this.nextRequestId = 1;
    this.pending = new Map();

    socket.setNoDelay(true);
    socket.on('data', this._onData.bind(this));
    socket.on('error', this._close.bind(this));
    socket.on('close', this._close.bind(this));
  }

  _onData(chunk) {
    if (this.closed || !Buffer.isBuffer(chunk)) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const nulIndex = this.buffer.indexOf(0);
    if (nulIndex !== -1) {
      const policyText = this.buffer.slice(0, nulIndex).toString('utf8').trim();
      if (policyText === POLICY_REQUEST) {
        this._sendPolicy();
        return;
      }
    }

    if (this.buffer.length > this.maxMessageBytes && this.buffer.indexOf(10) === -1) {
      this._destroy('message-too-large');
      return;
    }

    let newlineIndex = this.buffer.indexOf(10);
    while (newlineIndex !== -1 && !this.closed) {
      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0 && line[line.length - 1] === 13) line = line.slice(0, -1);
      if (line.length > this.maxMessageBytes) {
        this._destroy('message-too-large');
        return;
      }
      if (line.length > 0) this._handleLine(line);
      newlineIndex = this.buffer.indexOf(10);
    }
  }

  _sendPolicy() {
    const port = this.socket.localPort;
    const policy =
      '<?xml version="1.0"?>' +
      '<cross-domain-policy><allow-access-from domain="*" to-ports="' +
      port +
      '" /></cross-domain-policy>\0';
    this.socket.end(policy, 'utf8');
  }

  _handleLine(line) {
    let message;
    try {
      message = JSON.parse(line.toString('utf8'));
    } catch (_) {
      this._destroy('invalid-json');
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this._destroy('invalid-message');
      return;
    }

    if (message.type === 'hello') {
      if (
        typeof message.stageWidth !== 'number' ||
        !Number.isFinite(message.stageWidth) ||
        typeof message.stageHeight !== 'number' ||
        !Number.isFinite(message.stageHeight) ||
        typeof message.rootClass !== 'string'
      ) {
        this._destroy('invalid-hello');
        return;
      }
      this.hello = {
        stageWidth: message.stageWidth,
        stageHeight: message.stageHeight,
        rootClass: message.rootClass.slice(0, 512)
      };
      if (typeof this.onHello === 'function') this.onHello(this, this.hello);
      return;
    }

    if (message.type === 'snapshot' && typeof message.requestId === 'number') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (!Array.isArray(message.objects) || message.objects.length > 500) {
        pending.reject(createError('invalid-snapshot'));
        return;
      }
      pending.resolve({
        objects: message.objects,
        truncated: message.truncated === true
      });
      return;
    }

    if (message.type === 'error' && typeof message.requestId === 'number') {
      const failed = this.pending.get(message.requestId);
      if (!failed) return;
      this.pending.delete(message.requestId);
      clearTimeout(failed.timer);
      failed.reject(createError('agent-error'));
    }
  }

  _writeJson(message) {
    if (this.closed) throw createError('agent-disconnected');
    const payload = Buffer.from(JSON.stringify(message) + '\n', 'utf8');
    if (payload.length > this.maxMessageBytes) throw createError('message-too-large');
    this.socket.write(payload);
  }

  requestSnapshot() {
    if (!this.hello) return Promise.reject(createError('agent-not-ready'));
    const requestId = this.nextRequestId++;
    const self = this;
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        self.pending.delete(requestId);
        reject(createError('snapshot-timeout'));
      }, self.requestTimeoutMs);
      self.pending.set(requestId, { resolve: resolve, reject: reject, timer: timer });
      try {
        self._writeJson({ type: 'snapshot', requestId: requestId });
      } catch (error) {
        clearTimeout(timer);
        self.pending.delete(requestId);
        reject(error);
      }
    });
  }

  _destroy(code) {
    if (this.closed) return;
    this.closeCode = code;
    this.socket.destroy();
    this._close();
  }

  _close() {
    if (this.closed) return;
    this.closed = true;
    const error = createError(this.closeCode || 'agent-disconnected');
    this.pending.forEach(function (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pending.clear();
    if (typeof this.onDisconnect === 'function') this.onDisconnect(this);
  }

  close() {
    this._destroy('agent-disconnected');
  }
}

class FlashProbeServer {
  constructor(options) {
    const opts = options || {};
    this.host = HOST;
    this.port = parsePort(opts.port);
    this.maxMessageBytes = opts.maxMessageBytes || MAX_MESSAGE_BYTES;
    this.requestTimeoutMs = opts.requestTimeoutMs || REQUEST_TIMEOUT_MS;
    this.onHello = opts.onHello;
    this.onDisconnect = opts.onDisconnect;
    this.server = null;
    this.connections = new Set();
  }

  start() {
    if (this.server) return Promise.resolve({ host: this.host, port: this.port });
    const self = this;
    return new Promise(function (resolve, reject) {
      const server = net.createServer(function (socket) {
        let connection;
        connection = new ProbeConnection(socket, {
          maxMessageBytes: self.maxMessageBytes,
          requestTimeoutMs: self.requestTimeoutMs,
          onHello: self.onHello,
          onDisconnect: function (closedConnection) {
            self.connections.delete(closedConnection);
            if (typeof self.onDisconnect === 'function') {
              self.onDisconnect(closedConnection);
            }
          }
        });
        self.connections.add(connection);
      });
      self.server = server;
      server.once('error', function (error) {
        if (!server.listening) self.server = null;
        reject(error);
      });
      server.listen(self.port, self.host, function () {
        resolve({ host: self.host, port: self.port });
      });
    });
  }

  stop() {
    const connections = Array.from(this.connections);
    connections.forEach(function (connection) {
      connection.close();
    });
    this.connections.clear();
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = null;
    return new Promise(function (resolve) {
      server.close(function () {
        resolve();
      });
    });
  }
}

module.exports = {
  HOST: HOST,
  DEFAULT_PORT: DEFAULT_PORT,
  MAX_MESSAGE_BYTES: MAX_MESSAGE_BYTES,
  REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
  parsePort: parsePort,
  ProbeConnection: ProbeConnection,
  FlashProbeServer: FlashProbeServer
};
