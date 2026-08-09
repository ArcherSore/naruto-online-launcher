'use strict';

const { AutomationError, CODES, toAutomationError, toSafeError } = require('../errors');

describe('automation errors', () => {
  test('publishes the complete stable kebab-case code catalog', () => {
    expect(Object.values(CODES)).toEqual(
      expect.arrayContaining([
        'scripts-root-unavailable',
        'manifest-json-invalid',
        'script-id-conflict',
        'api-version-incompatible',
        'profile-not-found',
        'profile-busy',
        'game-not-ready',
        'run-cancelled',
        'run-timeout',
        'cdp-dispatch-failed',
        'storage-read-failed',
        'storage-write-failed'
      ])
    );
    Object.values(CODES).forEach(function (code) {
      expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(new AutomationError(code).safeMessage).toEqual(expect.any(String));
    });
  });

  test('preserves only a known automation error and applies a safe fallback otherwise', () => {
    const known = new AutomationError('profile-busy');
    expect(toAutomationError(known, 'script-failed')).toBe(known);
    const converted = toAutomationError(new Error('cookie=sensitive-value'), 'script-failed');
    expect(converted).toBeInstanceOf(AutomationError);
    expect(converted.code).toBe('script-failed');
    expect(converted.message).not.toContain('sensitive-value');
    expect(converted.cause).toBeUndefined();
  });

  test('returns a frozen public DTO without raw text, stack, path, or extra fields', () => {
    const raw = new Error('C:\\secret\\entry.js cookie=sensitive-value');
    raw.code = 'ENOENT';
    const safe = toSafeError(raw, 'entry-load-failed');
    expect(safe).toEqual({
      code: 'entry-load-failed',
      safeMessage: expect.any(String)
    });
    expect(Object.isFrozen(safe)).toBe(true);
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(safe.stack).toBeUndefined();
    expect(safe.cause).toBeUndefined();
  });
});
