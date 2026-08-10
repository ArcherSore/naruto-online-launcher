'use strict';

const { createCancellationController } = require('../cancellation');

describe('automation cancellation', () => {
  test('exposes a read-only Node 12 compatible signal and keeps the first reason', () => {
    const controller = createCancellationController();
    expect(controller.signal.aborted).toBe(false);
    expect(controller.signal.reason).toBe(null);
    expect(controller.signal.abort).toBeUndefined();
    expect(controller.signal.controller).toBeUndefined();
    expect(controller.abort('user-stop')).toBe(true);
    expect(controller.abort('timeout')).toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('user-stop');
  });

  test('supports once listeners, removal, and onabort exactly once', () => {
    const controller = createCancellationController();
    const once = jest.fn();
    const removed = jest.fn();
    const onabort = jest.fn();
    controller.signal.addEventListener('abort', once, { once: true });
    controller.signal.addEventListener('abort', removed);
    controller.signal.removeEventListener('abort', removed);
    controller.signal.onabort = onabort;
    controller.abort('app-quit');
    controller.abort('timeout');
    expect(once).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect(onabort).toHaveBeenCalledTimes(1);
    expect(once.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: 'abort', target: controller.signal })
    );
  });

  test('isolates listener failures and ignores unsupported event types', () => {
    const controller = createCancellationController();
    const later = jest.fn();
    controller.signal.addEventListener('change', later);
    controller.signal.addEventListener('abort', function () {
      throw new Error('listener failure');
    });
    controller.signal.addEventListener('abort', later);
    expect(function () {
      controller.abort('window-closed');
    }).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });

  test('keeps the first run boundary reason for Vision timeout races', () => {
    const controller = createCancellationController();
    controller.abort('timeout');
    controller.abort('user-stop');
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('timeout');
  });
});
