/**
 * Testes para src/config/settings.js
 * Nota: Este módulo depende de electron.app, então testamos a lógica de validação
 */

// Mock do electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData')
  }
}));

// Mock do fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn()
}));

const { validateConfig, loadConfig, saveConfig } = require('../settings');

describe('settings.js - validateConfig', () => {
  test('retorna defaults para config vazia', () => {
    const result = validateConfig({});
    expect(result.region).toBe('pt');
    expect(result.hardwareProfile).toBe('modern');
  });

  test('retorna defaults para config undefined', () => {
    const result = validateConfig(undefined);
    expect(result.region).toBe('pt');
    expect(result.hardwareProfile).toBe('modern');
  });

  test('retorna defaults para config null', () => {
    const result = validateConfig(null);
    expect(result.region).toBe('pt');
    expect(result.hardwareProfile).toBe('modern');
  });

  test('mantém região válida', () => {
    const result = validateConfig({ region: 'en' });
    expect(result.region).toBe('en');
  });

  test('mantém perfil válido', () => {
    const result = validateConfig({ hardwareProfile: 'legacy' });
    expect(result.hardwareProfile).toBe('legacy');
  });

  test('mantém ambos valores válidos', () => {
    const result = validateConfig({
      region: 'de',
      hardwareProfile: 'cpu'
    });
    expect(result.region).toBe('de');
    expect(result.hardwareProfile).toBe('cpu');
  });

  test('sanitiza região inválida', () => {
    const result = validateConfig({ region: 'invalid' });
    expect(result.region).toBe('pt'); // fallback para default
  });

  test('sanitiza perfil inválido', () => {
    const result = validateConfig({ hardwareProfile: 'invalid' });
    expect(result.hardwareProfile).toBe('modern'); // fallback para default
  });

  test('ignora propriedades desconhecidas', () => {
    const result = validateConfig({
      region: 'fr',
      unknownProp: 'should be ignored'
    });
    expect(result.region).toBe('fr');
    expect(result).not.toHaveProperty('unknownProp');
  });
});

describe('settings.js - loadConfig', () => {
  const fs = require('fs');

  beforeEach(() => {
    fs.existsSync.mockReset();
    fs.readFileSync.mockReset();
  });

  test('retorna defaults quando arquivo não existe', () => {
    fs.existsSync.mockReturnValue(false);
    const config = loadConfig();
    expect(config.region).toBe('pt');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('parseia JSON válido do arquivo', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{"region":"en","hardwareProfile":"legacy"}');
    const config = loadConfig();
    expect(config.region).toBe('en');
    expect(config.hardwareProfile).toBe('legacy');
  });

  test('retorna defaults quando JSON é inválido', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not-json{{{');
    const config = loadConfig();
    expect(config.region).toBe('pt');
  });
});

describe('settings.js - saveConfig', () => {
  const fs = require('fs');

  beforeEach(() => {
    fs.writeFileSync.mockReset();
    fs.renameSync.mockReset();
  });

  test('escreve e renomeia arquivo tmp → config', () => {
    const result = saveConfig({ region: 'de', hardwareProfile: 'cpu' });
    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
    // tmp path ends with .tmp
    var tmpArg = fs.writeFileSync.mock.calls[0][0];
    expect(tmpArg).toMatch(/\.tmp$/);
  });

  test('retorna false quando write falha', () => {
    fs.writeFileSync.mockImplementation(function () {
      throw new Error('EACCES');
    });
    const result = saveConfig({ region: 'pt' });
    expect(result).toBe(false);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });
});
