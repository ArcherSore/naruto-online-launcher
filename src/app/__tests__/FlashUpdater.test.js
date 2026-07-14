/**
 * Testes para src/app/FlashUpdater.js (Fase 2)
 *
 * Foco em funções PURAS (sem rede): pickAsset, cache queries, isCacheStale.
 * ensureLatest/refreshIfStale dependem de rede e são testadas manualmente.
 */

const fs = require('fs');
const FlashUpdater = require('../FlashUpdater');

describe('FlashUpdater.js', () => {
  describe('pickAsset', () => {
    const release = {
      tag_name: 'v34.0.0.137',
      assets: [
        { name: 'clean-flash-linux.tar.xz', browser_download_url: 'https://x/linux.tar.xz', size: 17000000 },
        { name: 'clean-flash-windows.exe', browser_download_url: 'https://x/windows.exe', size: 16000000 },
        { name: 'checksums.txt', browser_download_url: 'https://x/checksums.txt', size: 200 },
      ],
    };

    test('seleciona asset Linux (.tar.xz) quando platform=linux', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const a = FlashUpdater.pickAsset(release);
      expect(a).not.toBeNull();
      expect(a.name).toBe('clean-flash-linux.tar.xz');
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });

    test('seleciona asset Windows (.exe) quando platform=win32', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      const a = FlashUpdater.pickAsset(release);
      expect(a).not.toBeNull();
      expect(a.name).toBe('clean-flash-windows.exe');
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });

    test('retorna null quando nenhum asset casa com a plataforma', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const a = FlashUpdater.pickAsset({ tag_name: 'v1', assets: [{ name: 'readme.md' }] });
      expect(a).toBeNull();
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });

    test('retorna null quando release não tem assets', () => {
      expect(FlashUpdater.pickAsset({})).toBeNull();
      expect(FlashUpdater.pickAsset(null)).toBeNull();
    });
  });

  describe('cache path helpers', () => {
    test('getCacheDir termina com flash-cache', () => {
      const dir = FlashUpdater.getCacheDir();
      expect(dir.endsWith('flash-cache')).toBe(true);
    });

    test('getCachedPluginPath aponta para libpepflashplayer.so no Linux', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const p = FlashUpdater.getCachedPluginPath();
      expect(p.endsWith('libpepflashplayer.so')).toBe(true);
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });

    test('getCachedPluginPath aponta para pepflashplayer.dll no Windows', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      const p = FlashUpdater.getCachedPluginPath();
      expect(p.endsWith('pepflashplayer.dll')).toBe(true);
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });
  });

  describe('hasCachedPlugin', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    test('retorna false quando o arquivo não existe', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(FlashUpdater.hasCachedPlugin()).toBe(false);
    });

    test('retorna false quando o arquivo é menor que 1MB (corrompido)', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 500 * 1024 });
      expect(FlashUpdater.hasCachedPlugin()).toBe(false);
    });

    test('retorna true quando o arquivo existe e é maior que 1MB', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 17 * 1024 * 1024 });
      expect(FlashUpdater.hasCachedPlugin()).toBe(true);
    });
  });

  describe('getCacheInfo', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    test('retorna null quando cache-manifest.json não existe', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(FlashUpdater.getCacheInfo()).toBeNull();
    });

    test('retorna null quando manifest é JSON inválido', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('{not json');
      expect(FlashUpdater.getCacheInfo()).toBeNull();
    });

    test('retorna null quando manifest não tem downloadDate', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ version: '34.0.0.137' }));
      expect(FlashUpdater.getCacheInfo()).toBeNull();
    });

    test('retorna objeto parsed quando manifest é válido', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const data = { version: '34.0.0.137', downloadDate: '2026-01-01T00:00:00.000Z', assetName: 'clean-flash-linux.tar.xz' };
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(data));
      const info = FlashUpdater.getCacheInfo();
      expect(info).not.toBeNull();
      expect(info.version).toBe('34.0.0.137');
      expect(info.assetName).toBe('clean-flash-linux.tar.xz');
    });
  });

  describe('isCacheStale', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    test('retorna true quando não há cache info', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(FlashUpdater.isCacheStale()).toBe(true);
    });

    test('retorna true quando cache tem mais de STALE_DAYS', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const old = new Date(Date.now() - (FlashUpdater.STALE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ downloadDate: old }));
      expect(FlashUpdater.isCacheStale()).toBe(true);
    });

    test('retorna false quando cache é recente', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const fresh = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min atrás
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ downloadDate: fresh }));
      expect(FlashUpdater.isCacheStale()).toBe(false);
    });
  });

  describe('constants', () => {
    test('CACHE_SUBDIR é flash-cache', () => {
      expect(FlashUpdater.CACHE_SUBDIR).toBe('flash-cache');
    });
    test('STALE_DAYS é 7', () => {
      expect(FlashUpdater.STALE_DAYS).toBe(7);
    });
  });
});
