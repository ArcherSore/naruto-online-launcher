'use strict';

const fs = require('fs');
const path = require('path');
const fixtures = require('../../../tests/helpers/automation-fixtures');
const { createAutomationStore } = require('../store');

describe('automation config store', () => {
  afterEach(function () {
    jest.restoreAllMocks();
    fixtures.cleanupTempRoots();
  });

  function makeStore(root) {
    return createAutomationStore({
      rootDir: root,
      profileExists: function (id) {
        return id === 'p_aaaaaaaa' || id === 'p_bbbbbbbb';
      },
      scriptExists: function (id) {
        return id === 'demo-click' || id === 'other-script';
      },
      now: function () { return 123; }
    });
  }

  function configFile(root, profileId, scriptId) {
    return path.join(root, 'profiles', profileId, 'scripts', scriptId, 'config.json');
  }

  test('returns a frozen default and rejects unknown identities', () => {
    const store = makeStore(fixtures.createTempUserData());
    const config = store.getConfig('p_aaaaaaaa', 'demo-click');
    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(function () { store.getConfig('missing-profile', 'demo-click'); })
      .toThrow(expect.objectContaining({ code: 'profile-not-found' }));
    expect(function () { store.getConfig('p_aaaaaaaa', 'missing-script'); })
      .toThrow(expect.objectContaining({ code: 'script-not-found' }));
  });

  test('writes a versioned envelope and returns a deep-frozen copy', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    store.setConfig('p_aaaaaaaa', 'demo-click', { nested: { delayMs: 1000 } });
    const config = store.getConfig('p_aaaaaaaa', 'demo-click');
    expect(Object.isFrozen(config.nested)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configFile(root, 'p_aaaaaaaa', 'demo-click')))).toEqual({
      schemaVersion: 1,
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      updatedAt: new Date(123).toISOString(),
      config: { nested: { delayMs: 1000 } }
    });
  });

  test('rejects unsafe, damaged, and oversized config data', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    const cyclic = {};
    cyclic.self = cyclic;
    [{ value: NaN }, { value: Infinity }, { value: function () {} }, cyclic, []]
      .forEach(function (value) {
        expect(function () { store.setConfig('p_aaaaaaaa', 'demo-click', value); })
          .toThrow(expect.objectContaining({ code: 'config-invalid' }));
      });
    fs.mkdirSync(path.dirname(configFile(root, 'p_aaaaaaaa', 'demo-click')), { recursive: true });
    fs.writeFileSync(configFile(root, 'p_aaaaaaaa', 'demo-click'), 'x'.repeat(256 * 1024 + 1));
    expect(function () { store.getConfig('p_aaaaaaaa', 'demo-click'); })
      .toThrow(expect.objectContaining({ code: 'config-invalid' }));
  });

  test('keeps Profile and script config isolated across recreation and targeted clear', () => {
    const root = fixtures.createTempUserData();
    const pairs = [
      ['p_aaaaaaaa', 'demo-click', 1],
      ['p_aaaaaaaa', 'other-script', 2],
      ['p_bbbbbbbb', 'demo-click', 3],
      ['p_bbbbbbbb', 'other-script', 4]
    ];
    pairs.forEach(function (item) {
      makeStore(root).setConfig(item[0], item[1], { value: item[2] });
    });
    makeStore(root).clearConfig('p_aaaaaaaa', 'demo-click');
    expect(makeStore(root).getConfig('p_aaaaaaaa', 'demo-click')).toEqual({});
    pairs.slice(1).forEach(function (item) {
      expect(makeStore(root).getConfig(item[0], item[1])).toEqual({ value: item[2] });
    });
  });

  test('keeps the previous file when atomic replacement fails and removes temporary files', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    store.setConfig('p_aaaaaaaa', 'demo-click', { value: 'old' });
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(function () { throw new Error('disk busy'); });
    expect(function () { store.setConfig('p_aaaaaaaa', 'demo-click', { value: 'new' }); })
      .toThrow(expect.objectContaining({ code: 'storage-write-failed' }));
    expect(makeStore(root).getConfig('p_aaaaaaaa', 'demo-click')).toEqual({ value: 'old' });
    expect(fs.readdirSync(path.dirname(configFile(root, 'p_aaaaaaaa', 'demo-click'))))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/\.tmp$/)]));
  });
});
