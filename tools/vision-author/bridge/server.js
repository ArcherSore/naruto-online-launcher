'use strict';

const defaultNet = require('net');
const crypto = require('crypto');
const protocol = require('./protocol');

function createBridgeServer(options) {
  const opts = options || {};
  const net = opts.net || defaultNet;
  if (typeof opts.pipeName !== 'string' || !opts.pipeName) throw new TypeError('pipeName is required');
  if (typeof opts.token !== 'string') throw new TypeError('token is required');
  if (typeof opts.dispatch !== 'function') throw new TypeError('dispatch is required');
  const sessionId = opts.sessionId || crypto.randomBytes(16).toString('hex');
  let token = opts.token;
  let listener = null;
  let activeSocket = null;
  let closing = false;
  let started = false;

  function endSocket(socket) {
    if (!socket) return;
    if (activeSocket === socket) activeSocket = null;
    try {
      if (typeof socket.end === 'function') socket.end();
    } catch (_) {
      /* socket is already closed */
    }
    try {
      if (typeof socket.destroy === 'function') socket.destroy();
    } catch (_) {
      /* socket is already closed */
    }
  }

  function handleConnection(socket) {
    if (closing || activeSocket) {
      endSocket(socket);
      return;
    }
    activeSocket = socket;
    let requestPending = false;
    let connectionClosed = false;
    const connection = protocol.createConnectionProtocol({ token: token });

    function failClosed() {
      if (connectionClosed) return;
      connectionClosed = true;
      connection.dispose();
      endSocket(socket);
    }

    function writeResponse(response) {
      if (connectionClosed || activeSocket !== socket) return;
      try {
        socket.write(protocol.encodeMessage(response));
      } catch (_) {
        failClosed();
      }
    }

    const decoder = protocol.createFrameDecoder({
      onMessage: function (message) {
        if (requestPending) {
          failClosed();
          return;
        }
        let accepted;
        try {
          accepted = connection.accept(message);
        } catch (_) {
          failClosed();
          return;
        }
        if (accepted.kind === 'hello') {
          token = null;
          writeResponse(
            protocol.successResponse(accepted.requestId, {
              sessionId: sessionId,
              protocolVersion: protocol.PROTOCOL_VERSION
            })
          );
          return;
        }
        requestPending = true;
        Promise.resolve()
          .then(function () {
            return opts.dispatch(accepted.op, accepted.payload, {
              sessionId: sessionId,
              requestId: accepted.requestId
            });
          })
          .then(
            function (result) {
              writeResponse(protocol.successResponse(accepted.requestId, result));
              if (accepted.op === 'session.close') failClosed();
            },
            function (error) {
              writeResponse(protocol.failureResponse(accepted.requestId, error));
            }
          )
          .finally(function () {
            requestPending = false;
          });
      }
    });

    if (typeof socket.on === 'function') {
      socket.on('data', function (chunk) {
        try {
          decoder.push(chunk);
        } catch (_) {
          failClosed();
        }
      });
      socket.on('error', failClosed);
      socket.on('close', function () {
        connectionClosed = true;
        if (activeSocket === socket) activeSocket = null;
        if (typeof opts.onDisconnect === 'function') opts.onDisconnect();
      });
    }
  }

  function start() {
    if (started) return Promise.resolve();
    started = true;
    return new Promise(function (resolve, reject) {
      listener = net.createServer(handleConnection);
      if (listener && typeof listener.once === 'function') listener.once('error', reject);
      listener.listen(opts.pipeName, function () {
        if (listener && typeof listener.removeListener === 'function') {
          listener.removeListener('error', reject);
        }
        resolve();
      });
    });
  }

  function close() {
    if (closing) return Promise.resolve();
    closing = true;
    endSocket(activeSocket);
    activeSocket = null;
    token = null;
    if (!listener || typeof listener.close !== 'function') return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        listener.close(function () { resolve(); });
      } catch (_) {
        resolve();
      }
    });
  }

  return Object.freeze({
    start: start,
    close: close,
    pipeName: opts.pipeName,
    hasClient: function () { return !!activeSocket; }
  });
}

module.exports = { createBridgeServer: createBridgeServer };
