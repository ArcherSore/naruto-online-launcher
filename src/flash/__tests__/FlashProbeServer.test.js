'use strict';

const EventEmitter = require('events');
const {
  HOST,
  MAX_MESSAGE_BYTES,
  parsePort,
  ProbeConnection
} = require('../FlashProbeServer');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.localPort = 32145;
    this.writes = [];
    this.destroyed = false;
  }
  setNoDelay() {}
  write(payload) {
    this.writes.push(Buffer.from(payload));
  }
  end(payload) {
    this.writes.push(Buffer.from(payload));
  }
  destroy() {
    this.destroyed = true;
  }
}

function createConnection(socket, onHello) {
  return new ProbeConnection(socket, {
    maxMessageBytes: MAX_MESSAGE_BYTES,
    requestTimeoutMs: 1000,
    onHello: onHello
  });
}

describe('FlashProbe loopback transport', () => {
  test('固定监听地址并校验端口', () => {
    expect(HOST).toBe('127.0.0.1');
    expect(parsePort(undefined)).toBe(32145);
    expect(parsePort('32146')).toBe(32146);
    expect(() => parsePort('0')).toThrow('invalid-probe-port');
    expect(() => parsePort('not-a-port')).toThrow('invalid-probe-port');
  });

  test('hello 后可发送 snapshot 并按 requestId 接收结果', async () => {
    const socket = new FakeSocket();
    const onHello = jest.fn();
    const connection = createConnection(socket, onHello);
    socket.emit(
      'data',
      Buffer.from(
        '{"type":"hello","stageWidth":1440,"stageHeight":830,"rootClass":"GameRoot"}\n'
      )
    );

    expect(onHello).toHaveBeenCalledWith(connection, {
      stageWidth: 1440,
      stageHeight: 830,
      rootClass: 'GameRoot'
    });
    const pending = connection.requestSnapshot();
    const request = JSON.parse(socket.writes[0].toString('utf8'));
    socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'snapshot',
          requestId: request.requestId,
          objects: [{ name: 'root' }],
          truncated: false
        }) + '\n'
      )
    );

    await expect(pending).resolves.toEqual({
      objects: [{ name: 'root' }],
      truncated: false
    });
  });

  test('JSON 解析失败和超长消息都会断开连接', () => {
    const invalidJsonSocket = new FakeSocket();
    createConnection(invalidJsonSocket);
    invalidJsonSocket.emit('data', Buffer.from('{broken}\n'));
    expect(invalidJsonSocket.destroyed).toBe(true);

    const oversizedSocket = new FakeSocket();
    createConnection(oversizedSocket);
    oversizedSocket.emit('data', Buffer.alloc(MAX_MESSAGE_BYTES + 1, 120));
    expect(oversizedSocket.destroyed).toBe(true);
  });

  test('连接断开会拒绝等待中的 snapshot', async () => {
    const socket = new FakeSocket();
    const connection = createConnection(socket);
    socket.emit(
      'data',
      Buffer.from('{"type":"hello","stageWidth":1,"stageHeight":1,"rootClass":"Root"}\n')
    );
    const pending = connection.requestSnapshot();
    socket.emit('close');
    await expect(pending).rejects.toMatchObject({ code: 'agent-disconnected' });
  });

  test('响应 Pepper socket policy 请求后关闭该策略连接', () => {
    const socket = new FakeSocket();
    createConnection(socket);
    socket.emit('data', Buffer.from('<policy-file-request/>\0'));
    expect(socket.writes[0].toString('utf8')).toContain(
      '<allow-access-from domain="*" to-ports="32145" />'
    );
  });
});
