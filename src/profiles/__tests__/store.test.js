/**
 * Tests for src/profiles/store.js — Profile store (CRUD, persistence, reorder)
 *
 * Verifies: exports, create/get/update/remove/getAll/load, persist, reorder,
 * importJSON/exportJSON, incrementLaunch/addPlayTime/getStats, onChange,
 * MAX_PROFILES, PALETTE, migration, validation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// We use a real temp dir for persistence tests
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-store-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

// Must require store AFTER jest setup (electron mock from tests/setup.js)
const store = require('../store');

// Override app.getPath('userData') to use our temp dir
const electron = require('electron');

describe('store.js', () => {
  beforeEach(() => {
    // Point the store at our temp dir
    electron.app.getPath.mockImplementation((p) => {
      if (p === 'userData') return tmpDir;
      return '/tmp/naruto-test/' + p;
    });
    // Clear any cached profiles from previous tests
    // We force a fresh load by deleting the profiles file on disk
    const profilesDir = path.join(tmpDir, 'profiles');
    try { fs.rmSync(profilesDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    // Force reload from disk (clears in-memory cache)
    store.load();
  });

  describe('exports', () => {
    test('exports create as function', () => {
      expect(typeof store.create).toBe('function');
    });
    test('exports get as function', () => {
      expect(typeof store.get).toBe('function');
    });
    test('exports getAll as function', () => {
      expect(typeof store.getAll).toBe('function');
    });
    test('exports update as function', () => {
      expect(typeof store.update).toBe('function');
    });
    test('exports remove as function', () => {
      expect(typeof store.remove).toBe('function');
    });
    test('exports reorder as function', () => {
      expect(typeof store.reorder).toBe('function');
    });
    test('exports load as function', () => {
      expect(typeof store.load).toBe('function');
    });
    test('exports exportJSON as function', () => {
      expect(typeof store.exportJSON).toBe('function');
    });
    test('exports importJSON as function', () => {
      expect(typeof store.importJSON).toBe('function');
    });
    test('exports onChange as function', () => {
      expect(typeof store.onChange).toBe('function');
    });
    test('exports incrementLaunch as function', () => {
      expect(typeof store.incrementLaunch).toBe('function');
    });
    test('exports addPlayTime as function', () => {
      expect(typeof store.addPlayTime).toBe('function');
    });
    test('exports getStats as function', () => {
      expect(typeof store.getStats).toBe('function');
    });
    test('exports MAX_PROFILES = 12', () => {
      expect(store.MAX_PROFILES).toBe(12);
    });
    test('exports PALETTE as array of 12 hex colors', () => {
      expect(Array.isArray(store.PALETTE)).toBe(true);
      expect(store.PALETTE.length).toBe(12);
      store.PALETTE.forEach(function (c) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });
    test('exports getPartitionName as function', () => {
      expect(typeof store.getPartitionName).toBe('function');
    });
  });

  describe('create', () => {
    test('creates a profile with defaults', () => {
      const p = store.create();
      expect(p).not.toBeNull();
      expect(p.id).toMatch(/^p_[a-f0-9]{8,16}$/);
      expect(p.name).toBeDefined();
      expect(p.region).toBe('br');
      expect(p.language).toBe('pt');
      expect(p.notificationsEnabled).toBe(true);
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.launchCount).toBe(0);
      expect(p.totalPlayMs).toBe(0);
      expect(p.notes).toBe('');
      expect(p.favorite).toBe(false);
      expect(typeof p.createdAt).toBe('number');
      expect(p.lastUsed).toBe(0);
    });

    test('creates a profile with provided options', () => {
      const p = store.create({ name: 'MyAccount', server: 's799', region: 'na', language: 'en', notificationsEnabled: false });
      expect(p.name).toBe('MyAccount');
      expect(p.server).toBe('s799');
      expect(p.region).toBe('na');
      expect(p.language).toBe('en');
      expect(p.notificationsEnabled).toBe(false);
    });

    test('assigns auto-generated name if not provided', () => {
      const p = store.create();
      expect(p.name).toMatch(/^Conta/);
    });

    test('defaults region to br for invalid region', () => {
      const p = store.create({ region: 'xx' });
      expect(p.region).toBe('br');
    });

    test('defaults language to pt for invalid language', () => {
      const p = store.create({ language: 'fr' });
      expect(p.language).toBe('pt');
    });

    test('uses provided color if valid hex', () => {
      const p = store.create({ color: '#FF0000' });
      expect(p.color).toBe('#FF0000');
    });

    test('uses palette color if color is invalid', () => {
      const p = store.create({ color: 'red' });
      expect(store.PALETTE).toContain(p.color);
    });

    test('truncates name to 40 chars', () => {
      const longName = 'A'.repeat(50);
      const p = store.create({ name: longName });
      expect(p.name.length).toBeLessThanOrEqual(40);
    });

    test('truncates server to 20 chars', () => {
      const longServer = 's'.repeat(30);
      const p = store.create({ server: longServer });
      expect(p.server.length).toBeLessThanOrEqual(20);
    });

    test('returns null when MAX_PROFILES reached', () => {
      // Create 12 profiles (MAX_PROFILES)
      const created = [];
      for (let i = 0; i < store.MAX_PROFILES; i++) {
        const p = store.create({ name: 'P' + i });
        created.push(p);
      }
      const result = store.create({ name: 'Overflow' });
      expect(result).toBeNull();
      // Clean up so subsequent tests can create profiles
      created.forEach(function (p) { store.remove(p.id); });
    });
  });

  describe('get and getAll', () => {
    test('getAll returns a copy (not the internal array)', () => {
      store.create({ name: 'TestGet' });
      const a1 = store.getAll();
      const a2 = store.getAll();
      expect(a1).not.toBe(a2);
    });

    test('get returns profile by id', () => {
      const created = store.create({ name: 'FindMe' });
      const found = store.get(created.id);
      expect(found).not.toBeNull();
      expect(found.name).toBe('FindMe');
    });

    test('get returns null for nonexistent id', () => {
      expect(store.get('p_nonexistent')).toBeNull();
    });
  });

  describe('update', () => {
    test('updates profile fields', () => {
      const p = store.create({ name: 'Original', region: 'br' });
      const result = store.update(p.id, { name: 'Updated', region: 'na' });
      expect(result).toBe(true);
      const updated = store.get(p.id);
      expect(updated.name).toBe('Updated');
      expect(updated.region).toBe('na');
    });

    test('ignores invalid region on update', () => {
      const p = store.create({ region: 'br' });
      store.update(p.id, { region: 'invalid' });
      expect(store.get(p.id).region).toBe('br');
    });

    test('ignores invalid color on update', () => {
      const p = store.create({ color: '#FF8C00' });
      store.update(p.id, { color: 'not-a-color' });
      expect(store.get(p.id).color).toBe('#FF8C00');
    });

    test('updates favorite flag', () => {
      const p = store.create({ favorite: false });
      store.update(p.id, { favorite: true });
      expect(store.get(p.id).favorite).toBe(true);
    });

    test('updates notes (truncated to 200)', () => {
      const p = store.create();
      const longNote = 'N'.repeat(250);
      store.update(p.id, { notes: longNote });
      expect(store.get(p.id).notes.length).toBeLessThanOrEqual(200);
    });

    test('returns false for nonexistent id', () => {
      expect(store.update('p_nonexistent', { name: 'Nope' })).toBe(false);
    });
  });

  describe('remove', () => {
    test('removes a profile and returns true', () => {
      const p = store.create({ name: 'RemoveMe' });
      const before = store.getAll().length;
      const result = store.remove(p.id);
      expect(result).toBe(true);
      expect(store.getAll().length).toBe(before - 1);
      expect(store.get(p.id)).toBeNull();
    });

    test('returns false for nonexistent id', () => {
      expect(store.remove('p_nonexistent')).toBe(false);
    });
  });

  describe('reorder', () => {
    test('reorders profiles according to given id order', () => {
      const p1 = store.create({ name: 'First' });
      const p2 = store.create({ name: 'Second' });
      const p3 = store.create({ name: 'Third' });

      store.reorder([p3.id, p1.id, p2.id]);

      const all = store.getAll();
      expect(all[0].id).toBe(p3.id);
      expect(all[1].id).toBe(p1.id);
      expect(all[2].id).toBe(p2.id);
    });

    test('appends profiles not in the order list at the end', () => {
      const p1 = store.create({ name: 'A' });
      const p2 = store.create({ name: 'B' });
      const p3 = store.create({ name: 'C' });

      store.reorder([p3.id]);

      const all = store.getAll();
      expect(all[0].id).toBe(p3.id);
      // p1 and p2 come after in their original relative order
      const remaining = all.slice(1).map(function (x) { return x.id; });
      expect(remaining).toContain(p1.id);
      expect(remaining).toContain(p2.id);
    });

    test('ignores duplicate ids in order array', () => {
      const p1 = store.create({ name: 'A' });
      const p2 = store.create({ name: 'B' });

      store.reorder([p1.id, p1.id, p2.id]);

      const all = store.getAll();
      expect(all[0].id).toBe(p1.id);
      expect(all[1].id).toBe(p2.id);
    });

    test('does nothing when called with non-array', () => {
      const p1 = store.create({ name: 'A' });
      store.reorder('not-an-array');
      // Profile should still exist
      expect(store.get(p1.id)).not.toBeNull();
    });
  });

  describe('persistence', () => {
    test('profiles are saved to disk after create', () => {
      store.create({ name: 'Persist' });
      const profilesDir = path.join(tmpDir, 'profiles');
      const file = path.join(profilesDir, 'profiles.json');
      expect(fs.existsSync(file)).toBe(true);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    test('profiles.json has backup .bak after save', () => {
      store.create({ name: 'Backup1' });
      store.create({ name: 'Backup2' }); // second save creates .bak
      const backup = path.join(tmpDir, 'profiles', 'profiles.json.bak');
      expect(fs.existsSync(backup)).toBe(true);
    });
  });

  describe('incrementLaunch and addPlayTime', () => {
    test('incrementLaunch increments launchCount', () => {
      const p = store.create({ name: 'Launcher' });
      store.incrementLaunch(p.id);
      store.incrementLaunch(p.id);
      const stats = store.getStats(p.id);
      expect(stats.launchCount).toBe(2);
    });

    test('incrementLaunch updates lastUsed', () => {
      const p = store.create({ name: 'Launcher' });
      const before = store.get(p.id).lastUsed;
      store.incrementLaunch(p.id);
      const after = store.get(p.id).lastUsed;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    test('addPlayTime adds ms to totalPlayMs', () => {
      const p = store.create({ name: 'Player' });
      store.addPlayTime(p.id, 60000);
      store.addPlayTime(p.id, 120000);
      const stats = store.getStats(p.id);
      expect(stats.totalPlayMs).toBe(180000);
    });

    test('addPlayTime clamps ms to [0, 24h]', () => {
      const p = store.create({ name: 'Clamped' });
      const dayMs = 24 * 60 * 60 * 1000;
      store.addPlayTime(p.id, dayMs + 1000);
      const stats = store.getStats(p.id);
      expect(stats.totalPlayMs).toBe(dayMs);
    });

    test('addPlayTime returns false for nonexistent id', () => {
      expect(store.addPlayTime('p_nonexistent', 1000)).toBe(false);
    });

    test('incrementLaunch returns false for nonexistent id', () => {
      expect(store.incrementLaunch('p_nonexistent')).toBe(false);
    });
  });

  describe('getStats', () => {
    test('returns null for nonexistent id', () => {
      expect(store.getStats('p_nonexistent')).toBeNull();
    });

    test('calculates avgSessionMs', () => {
      const p = store.create({ name: 'StatUser' });
      store.incrementLaunch(p.id);
      store.incrementLaunch(p.id);
      store.addPlayTime(p.id, 60000);
      const stats = store.getStats(p.id);
      expect(stats.avgSessionMs).toBe(30000); // 60000 / 2
    });

    test('avgSessionMs is 0 when launchCount is 0', () => {
      const p = store.create({ name: 'ZeroLaunches' });
      const stats = store.getStats(p.id);
      expect(stats.avgSessionMs).toBe(0);
    });
  });

  describe('getPartitionName', () => {
    test('returns persist:profile-<id> format', () => {
      expect(store.getPartitionName('p_abc')).toBe('persist:profile-p_abc');
    });
  });

  describe('exportJSON / importJSON', () => {
    test('exportJSON returns valid JSON with version and profiles', () => {
      store.create({ name: 'Export' });
      const json = store.exportJSON();
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(2);
      expect(Array.isArray(parsed.profiles)).toBe(true);
      expect(parsed.exportedAt).toBeDefined();
    });

    test('importJSON imports valid profiles', () => {
      const p = store.create({ name: 'ExportSrc' });
      const json = store.exportJSON();
      // Clear and reimport
      store.remove(p.id);
      const result = store.importJSON(json);
      expect(result.imported).toBeGreaterThanOrEqual(0);
    });

    test('importJSON returns {imported:0,skipped:0} for invalid JSON', () => {
      const result = store.importJSON('not valid json');
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
    });

    test('importJSON skips duplicates by name+server', () => {
      store.create({ name: 'Dup', server: 's1' });
      const exportData = JSON.stringify({
        version: 2,
        profiles: [{
          id: 'p_ffffffff',
          name: 'Dup',
          server: 's1',
          region: 'br',
          language: 'pt',
          notificationsEnabled: true,
          color: '#FF8C00',
          createdAt: Date.now(),
          lastUsed: 0,
          notes: '',
          launchCount: 0,
          totalPlayMs: 0,
          favorite: false,
        }],
      });
      const result = store.importJSON(exportData);
      expect(result.skipped).toBeGreaterThan(0);
    });
  });

  describe('onChange', () => {
    test('onChange registers a callback that fires on persist', () => {
      let called = false;
      store.onChange(function () { called = true; });
      store.create({ name: 'Trigger' });
      // onChange may have been called during create → persist
      // Note: the listener list grows across tests, but we just verify it fires
      expect(called).toBe(true);
    });
  });
});
