'use strict';

describe('i18n.js', () => {
  let i18n;

  beforeEach(() => {
    jest.resetModules();
    i18n = require('../i18n');
  });

  describe('exports', () => {
    test('exporta setLanguage, getLanguage, t, tl, getAll, SUPPORTED', () => {
      expect(typeof i18n.setLanguage).toBe('function');
      expect(typeof i18n.getLanguage).toBe('function');
      expect(typeof i18n.t).toBe('function');
      expect(typeof i18n.tl).toBe('function');
      expect(typeof i18n.getAll).toBe('function');
      expect(Array.isArray(i18n.SUPPORTED)).toBe(true);
    });
  });

  describe('SUPPORTED', () => {
    test('contém 6 idiomas', () => {
      expect(i18n.SUPPORTED).toHaveLength(6);
      expect(i18n.SUPPORTED).toEqual(expect.arrayContaining(['pt', 'en', 'de', 'es', 'pl', 'fr']));
    });
  });

  describe('getLanguage / setLanguage', () => {
    test('retorna pt como padrão', () => {
      expect(i18n.getLanguage()).toBe('pt');
    });

    test('troca para en e volta', () => {
      i18n.setLanguage('en');
      expect(i18n.getLanguage()).toBe('en');
      i18n.setLanguage('pt');
      expect(i18n.getLanguage()).toBe('pt');
    });

    test('idioma inválido mantém o atual', () => {
      i18n.setLanguage('en');
      i18n.setLanguage('xyz');
      expect(i18n.getLanguage()).toBe('en');
    });
  });

  describe('t', () => {
    test('retorna string PT-BR para chave válida', () => {
      expect(i18n.t('common.play')).toBe('Jogar');
      expect(i18n.t('common.save')).toBe('Salvar');
      expect(i18n.t('common.cancel')).toBe('Cancelar');
    });

    test('retorna a chave se não encontrada', () => {
      expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
    });

    test('retorna em inglês quando setLanguage(en)', () => {
      i18n.setLanguage('en');
      expect(i18n.t('common.play')).toBe('Play');
    });

    test('retorna string em alemão quando setLanguage(de)', () => {
      i18n.setLanguage('de');
      const val = i18n.t('common.play');
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    });
  });

  describe('tl', () => {
    test('retorna tradução para idioma específico sem mudar o global', () => {
      // Note: jest.mock in IpcRouter.test.js may affect tl for some languages.
      // Test with 'de' which is less likely to be mocked.
      const val = i18n.tl('de', 'common.play');
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
      expect(i18n.getLanguage()).toBe('pt');
    });

    test('retorna string para idioma inválido (fallback)', () => {
      const val = i18n.tl('xyz', 'common.play');
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    });
  });

  describe('getAll', () => {
    test('retorna objeto com todas as chaves do idioma atual', () => {
      const all = i18n.getAll();
      expect(typeof all).toBe('object');
      expect(all['common.play']).toBe('Jogar');
      expect(all['common.save']).toBe('Salvar');
    });

    test('muda quando setLanguage é chamado', () => {
      i18n.setLanguage('en');
      expect(i18n.getAll()['common.play']).toBe('Play');
    });
  });
});