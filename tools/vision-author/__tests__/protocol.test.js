'use strict';

const EventEmitter = require('events');
const helpers = require('./helpers');

function createSocket() {
  const socket = new EventEmitter();
  socket.writes = [];
  socket.ended = false;
  socket.destroyed = false;
  socket.write = jest.fn(function (bytes) {
    socket.writes.push(Buffer.from(bytes));
    return true;
  });
  socket.end = jest.fn(function () {
    socket.ended = true;
  });
  socket.destroy = jest.fn(function () {
    socket.destroyed = true;
  });
  return socket;
}

function request(requestId, op, payload) {
  return {
    protocolVersion: 1,
    type: 'request',
    requestId: requestId,
    op: op,
    payload: payload || {}
  };
}

describe('Vision Author bridge protocol', () => {
  test('decodes fragmented and coalesced 4-byte big-endian frames', () => {
    const protocol = require('../bridge/protocol');
    const messages = [];
    const decoder = protocol.createFrameDecoder({ onMessage: value => messages.push(value) });
    const first = protocol.encodeMessage({ value: 1 });
    const second = protocol.encodeMessage({ value: 2 });

    decoder.push(first.slice(0, 2));
    decoder.push(Buffer.concat([first.slice(2), second]));

    expect(messages).toEqual([{ value: 1 }, { value: 2 }]);
    expect(first.readUInt32BE(0)).toBe(first.length - 4);
  });

  test('rejects messages over 24 MiB and malformed JSON before dispatch', () => {
    const protocol = require('../bridge/protocol');
    expect(protocol.MAX_MESSAGE_BYTES).toBe(24 * 1024 * 1024);
    const decoder = protocol.createFrameDecoder({ onMessage: jest.fn() });
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(protocol.MAX_MESSAGE_BYTES + 1, 0);
    expect(() => decoder.push(prefix)).toThrow(expect.objectContaining({ code: 'message-too-large' }));

    const invalid = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from('{')]);
    expect(() => protocol.createFrameDecoder({ onMessage: jest.fn() }).push(invalid)).toThrow(
      expect.objectContaining({ code: 'protocol-invalid' })
    );
  });

  test('requires a strict hello first and compares the 256-bit token in constant time', () => {
    const protocol = require('../bridge/protocol');
    const token = helpers.randomToken();
    const timingSafeEqual = jest.fn(function (left, right) { return left.equals(right); });
    const connection = protocol.createConnectionProtocol({
      token: token,
      crypto: { timingSafeEqual: timingSafeEqual }
    });

    expect(() => connection.accept(request('r0', 'profiles.list'))).toThrow(
      expect.objectContaining({ code: 'authentication-failed' })
    );

    const authenticated = protocol.createConnectionProtocol({
      token: token,
      crypto: { timingSafeEqual: timingSafeEqual }
    });
    const hello = authenticated.accept(request('hello-1', 'hello', { token: token }));
    expect(hello.kind).toBe('hello');
    expect(authenticated.authenticated()).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalled();

    const wrong = protocol.createConnectionProtocol({ token: token });
    expect(() => wrong.accept(request('hello-2', 'hello', { token: helpers.randomToken() }))).toThrow(
      expect.objectContaining({ code: 'authentication-failed' })
    );
  });

  test('rejects duplicate requestId, unknown op, unknown fields and path-like payload fields', () => {
    const protocol = require('../bridge/protocol');
    const token = helpers.randomToken();
    const connection = protocol.createConnectionProtocol({ token: token });
    connection.accept(request('hello', 'hello', { token: token }));
    connection.accept(request('same', 'profiles.list', {}));
    expect(() => connection.accept(request('same', 'profiles.list', {}))).toThrow(
      expect.objectContaining({ code: 'protocol-invalid' })
    );
    expect(() => connection.accept(request('unknown', 'desktop.capture', {}))).toThrow(
      expect.objectContaining({ code: 'invalid-request' })
    );

    const extra = request('extra', 'profiles.list', {});
    extra.path = 'C:\\secret.png';
    expect(() => connection.accept(extra)).toThrow(
      expect.objectContaining({ code: 'invalid-request' })
    );
    expect(() => connection.accept(request('path', 'capture', {
      profileId: 'p_aaaaaaaa', selectionEpoch: 1, outputPath: 'C:\\secret.png'
    }))).toThrow(expect.objectContaining({ code: 'invalid-request' }));
  });

  test('server permits one authenticated client and unauthenticated requests have zero side effects', async () => {
    const { createBridgeServer } = require('../bridge/server');
    let connectionListener = null;
    const listener = new EventEmitter();
    listener.listen = jest.fn(function (_pipeName, callback) { callback(); });
    listener.close = jest.fn(function (callback) { if (callback) callback(); });
    const net = {
      createServer: jest.fn(function (callback) {
        connectionListener = callback;
        return listener;
      })
    };
    const dispatch = jest.fn(async function () { return { profiles: [] }; });
    const token = helpers.randomToken();
    const server = createBridgeServer({
      net: net,
      pipeName: '\\\\.\\pipe\\vision-author-test',
      token: token,
      dispatch: dispatch
    });
    await server.start();

    const first = createSocket();
    connectionListener(first);
    first.emit('data', helpers.encodeMessage(request('bad', 'profiles.list', {})));
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    expect(first.destroyed || first.ended).toBe(true);

    const authenticated = createSocket();
    connectionListener(authenticated);
    authenticated.emit('data', helpers.encodeMessage(request('hello', 'hello', { token: token })));
    await Promise.resolve();
    const second = createSocket();
    connectionListener(second);
    expect(second.destroyed || second.ended).toBe(true);

    authenticated.emit('data', helpers.encodeMessage(request('list', 'profiles.list', {})));
    await new Promise(resolve => setImmediate(resolve));
    expect(dispatch).toHaveBeenCalledTimes(1);
    await server.close();
  });

  test('safe errors never expose token, PNG, URL, path or raw exception text', () => {
    const protocol = require('../bridge/protocol');
    const error = protocol.safeError({
      code: 'storage-write-failed',
      message: 'failed C:\\secret\\target.png https://example.test token=abc data:image/png;base64,xyz'
    });
    expect(error).toEqual({
      code: 'storage-write-failed',
      safeMessage: expect.any(String),
      recovery: expect.any(String)
    });
    expect(JSON.stringify(error)).not.toMatch(/secret|example|base64|token=abc/i);
    const dto = protocol.safeError({ code: 'unknown-code', message: 'Cookie Session Partition webContents' });
    expect(JSON.stringify(dto)).not.toMatch(/cookie|session|partition|webContents/i);
  });
});
