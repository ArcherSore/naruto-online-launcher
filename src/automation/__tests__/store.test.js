'use strict';

const fs = require('fs');
const path = require('path');
const fixtures = require('../../../tests/helpers/automation-fixtures');
const { createAutomationStore } = require('../store');

describe('automation store', () => {
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
      now: function () {
        return 123;
      }
    });
  }

  function dataFile(root, profileId, scriptId, fileName) {
    return path.join(root, 'profiles', profileId, 'scripts', scriptId, fileName);
  }

  test('returns frozen defaults for missing files and rejects unknown identities', () => {
    const store = makeStore(fixtures.createTempUserData());
    const config = store.getConfig('p_aaaaaaaa', 'demo-click');
    const points = store.getCoordinates('p_aaaaaaaa', 'demo-click');
    expect(config).toEqual({});
    expect(points).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(points)).toBe(true);
    expect(function () {
      store.getConfig('missing-profile', 'demo-click');
    }).toThrow(expect.objectContaining({ code: 'profile-not-found' }));
    expect(function () {
      store.getConfig('p_aaaaaaaa', 'missing-script');
    }).toThrow(expect.objectContaining({ code: 'script-not-found' }));
  });

  test('writes versioned config and coordinate envelopes and returns deep-frozen copies', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    store.setConfig('p_aaaaaaaa', 'demo-click', { nested: { delayMs: 1000 } });
    store.setCoordinates('p_aaaaaaaa', 'demo-click', [
      { order: 1, normalizedX: 0.25, normalizedY: 0.5 }
    ]);

    const config = store.getConfig('p_aaaaaaaa', 'demo-click');
    const points = store.getCoordinates('p_aaaaaaaa', 'demo-click');
    expect(Object.isFrozen(config.nested)).toBe(true);
    expect(Object.isFrozen(points[0])).toBe(true);
    expect(JSON.parse(fs.readFileSync(dataFile(root, 'p_aaaaaaaa', 'demo-click', 'config.json')))).toEqual({
      schemaVersion: 1,
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      updatedAt: new Date(123).toISOString(),
      config: { nested: { delayMs: 1000 } }
    });
  });

  test('rejects unsafe config, invalid coordinates, damaged identity, schema, and oversized files', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    const cyclic = {};
    cyclic.self = cyclic;
    [
      { value: NaN },
      { value: Infinity },
      { value: function () {} },
      cyclic,
      []
    ].forEach(function (value) {
      expect(function () {
        store.setConfig('p_aaaaaaaa', 'demo-click', value);
      }).toThrow(expect.objectContaining({ code: 'config-invalid' }));
    });
    expect(function () {
      store.setCoordinates('p_aaaaaaaa', 'demo-click', [
        { order: 2, normalizedX: 0.25, normalizedY: 0.5 }
      ]);
    }).toThrow(expect.objectContaining({ code: 'coordinates-invalid' }));
    expect(function () {
      store.setCoordinates('p_aaaaaaaa', 'demo-click', [
        { order: 1, normalizedX: 1, normalizedY: 0.5 }
      ]);
    }).toThrow(expect.objectContaining({ code: 'coordinates-invalid' }));

    fixtures.writeJson(dataFile(root, 'p_aaaaaaaa', 'demo-click', 'coordinates.json'), {
      schemaVersion: 1,
      profileId: 'p_bbbbbbbb',
      scriptId: 'demo-click',
      updatedAt: new Date(123).toISOString(),
      points: []
    });
    expect(function () {
      store.getCoordinates('p_aaaaaaaa', 'demo-click');
    }).toThrow(expect.objectContaining({ code: 'coordinates-invalid' }));

    fs.writeFileSync(
      dataFile(root, 'p_aaaaaaaa', 'demo-click', 'config.json'),
      'x'.repeat(256 * 1024 + 1)
    );
    expect(function () {
      store.getConfig('p_aaaaaaaa', 'demo-click');
    }).toThrow(expect.objectContaining({ code: 'config-invalid' }));
  });

  test('keeps two profiles by two scripts isolated across recreation and targeted clears', () => {
    const root = fixtures.createTempUserData();
    const pairs = [
      ['p_aaaaaaaa', 'demo-click', 0.1],
      ['p_aaaaaaaa', 'other-script', 0.2],
      ['p_bbbbbbbb', 'demo-click', 0.3],
      ['p_bbbbbbbb', 'other-script', 0.4]
    ];
    const store = makeStore(root);
    pairs.forEach(function (item) {
      store.setConfig(item[0], item[1], { value: item[2] });
      store.setCoordinates(item[0], item[1], [
        { order: 1, normalizedX: item[2], normalizedY: item[2] }
      ]);
    });
    makeStore(root).clearCoordinates('p_aaaaaaaa', 'demo-click');
    expect(makeStore(root).getCoordinates('p_aaaaaaaa', 'demo-click')).toEqual([]);
    expect(makeStore(root).getConfig('p_aaaaaaaa', 'demo-click')).toEqual({ value: 0.1 });
    pairs.slice(1).forEach(function (item) {
      expect(makeStore(root).getCoordinates(item[0], item[1])[0].normalizedX).toBe(item[2]);
      expect(makeStore(root).getConfig(item[0], item[1])).toEqual({ value: item[2] });
    });
  });

  test('keeps the previous file when atomic replacement fails and removes temporary files', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    store.setConfig('p_aaaaaaaa', 'demo-click', { value: 'old' });
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(function () {
      throw new Error('disk busy');
    });
    expect(function () {
      store.setConfig('p_aaaaaaaa', 'demo-click', { value: 'new' });
    }).toThrow(expect.objectContaining({ code: 'storage-write-failed' }));
    expect(makeStore(root).getConfig('p_aaaaaaaa', 'demo-click')).toEqual({ value: 'old' });
    expect(
      fs.readdirSync(path.dirname(dataFile(root, 'p_aaaaaaaa', 'demo-click', 'config.json')))
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.tmp$/)]));
  });

  test('survives script resource replacement and clears only the requested payload', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    store.setConfig('p_aaaaaaaa', 'demo-click', { installedVersion: '1.0.0' });
    store.setCoordinates('p_aaaaaaaa', 'demo-click', [
      { order: 1, normalizedX: 0.2, normalizedY: 0.3 }
    ]);
    store.setConfig('p_bbbbbbbb', 'other-script', { keep: true });
    store.setCoordinates('p_bbbbbbbb', 'other-script', [
      { order: 1, normalizedX: 0.7, normalizedY: 0.8 }
    ]);

    const afterInstallReplacement = makeStore(root);
    afterInstallReplacement.setConfig('p_aaaaaaaa', 'demo-click', { installedVersion: '2.0.0' });
    expect(afterInstallReplacement.getCoordinates('p_aaaaaaaa', 'demo-click')).toEqual([
      { order: 1, normalizedX: 0.2, normalizedY: 0.3 }
    ]);
    afterInstallReplacement.clearConfig('p_aaaaaaaa', 'demo-click');
    expect(makeStore(root).getConfig('p_aaaaaaaa', 'demo-click')).toEqual({});
    expect(makeStore(root).getCoordinates('p_aaaaaaaa', 'demo-click')).toHaveLength(1);
    expect(makeStore(root).getConfig('p_bbbbbbbb', 'other-script')).toEqual({ keep: true });
    expect(makeStore(root).getCoordinates('p_bbbbbbbb', 'other-script')).toHaveLength(1);
  });

  test('lets targeted clear recover incompatible data without deleting sibling data', () => {
    const root = fixtures.createTempUserData();
    const store = makeStore(root);
    store.setCoordinates('p_bbbbbbbb', 'demo-click', [
      { order: 1, normalizedX: 0.4, normalizedY: 0.5 }
    ]);
    fixtures.writeJson(dataFile(root, 'p_aaaaaaaa', 'demo-click', 'coordinates.json'), {
      schemaVersion: 99,
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      updatedAt: new Date(123).toISOString(),
      points: []
    });
    expect(function () {
      store.getCoordinates('p_aaaaaaaa', 'demo-click');
    }).toThrow(expect.objectContaining({ code: 'coordinates-invalid' }));
    expect(store.clearCoordinates('p_aaaaaaaa', 'demo-click')).toEqual([]);
    expect(makeStore(root).getCoordinates('p_aaaaaaaa', 'demo-click')).toEqual([]);
    expect(makeStore(root).getCoordinates('p_bbbbbbbb', 'demo-click')).toHaveLength(1);
  });
});
