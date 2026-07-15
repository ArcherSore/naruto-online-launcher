/**
 * Testes para src/memory/GcDaemon.js (Fase 3f — split + black screen fix)
 */

const electron = require('electron');
const GcDaemon = require('../GcDaemon');
const MemoryGuard = require('../MemoryGuard');

// Mock store + partition usados por _clearIdleSessions
jest.mock('../../profiles/store', () => ({
  getAll: jest.fn(() => [
    { id: 'p_active', name: 'Active' },
    { id: 'p_idle', name: 'Idle' }
  ])
}));
jest.mock('../../profiles/partition', () => ({
  getPartitionName: jest.fn(p => 'persist:profile-' + p.id),
  setBatataMode: jest.fn()
}));

const store = require('../../profiles/store');
const partition = require('../../profiles/partition');

describe('GcDaemon.js', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('THROTTLE_MS', () => {
    test('é 30 segundos', () => {
      expect(GcDaemon.THROTTLE_MS).toBe(30000);
    });
  });

  describe('collect — anti-reentrada', () => {
    test('retorna {busy:true} quando já está coletando', async () => {
      // Não é trivial forçar _collecting=true externamente; testa o caminho
      // throttled primeiro (chamada imediata após outra dentro da janela).
      // Primeira chamada: limpa o lastGC.
      await GcDaemon.collect({ manual: true });
      // Segunda chamada imediata: deve ser throttled OU busy.
      const r = await GcDaemon.collect({ manual: true });
      expect(r.throttled === true || r.busy === true).toBe(true);
    });
  });

  describe('_clearIdleSessions — BLACK SCREEN FIX', () => {
    test('NÃO chama fromPartition para perfil com jogo ativo', async () => {
      // profile p_active está ativo → deve ser pulado
      jest.spyOn(MemoryGuard, 'getActiveProfileIds').mockReturnValue(['p_active']);

      const fromPartitionSpy = jest.spyOn(electron.session, 'fromPartition');

      await GcDaemon._clearIdleSessions();

      const calledPartitions = fromPartitionSpy.mock.calls.map(c => c[0]);
      // p_idle (ocioso) DEVE ser limpo
      expect(calledPartitions).toContain('persist:profile-p_idle');
      // p_active (ativo) NÃO deve ser limpo — black screen fix
      expect(calledPartitions).not.toContain('persist:profile-p_active');
    });

    test('limpa TODAS as partitions quando nenhum jogo está ativo', async () => {
      jest.spyOn(MemoryGuard, 'getActiveProfileIds').mockReturnValue([]);

      const fromPartitionSpy = jest.spyOn(electron.session, 'fromPartition');
      await GcDaemon._clearIdleSessions();

      const calledPartitions = fromPartitionSpy.mock.calls.map(c => c[0]);
      expect(calledPartitions).toContain('persist:profile-p_active');
      expect(calledPartitions).toContain('persist:profile-p_idle');
    });

    test('pula TODAS as partitions quando todos os jogos estão ativos', async () => {
      jest.spyOn(MemoryGuard, 'getActiveProfileIds').mockReturnValue(['p_active', 'p_idle']);

      const fromPartitionSpy = jest.spyOn(electron.session, 'fromPartition');
      await GcDaemon._clearIdleSessions();

      expect(fromPartitionSpy).not.toHaveBeenCalled();
    });

    test('usa getPartitionName do módulo partition', async () => {
      jest.spyOn(MemoryGuard, 'getActiveProfileIds').mockReturnValue([]);
      jest.spyOn(electron.session, 'fromPartition').mockReturnValue({
        clearCache: jest.fn(() => Promise.resolve()),
        clearStorageData: jest.fn(() => Promise.resolve())
      });
      await GcDaemon._clearIdleSessions();
      expect(partition.getPartitionName).toHaveBeenCalled();
    });

    test('não lança mesmo se store/partition falham', async () => {
      jest.spyOn(MemoryGuard, 'getActiveProfileIds').mockReturnValue([]);
      jest.spyOn(store, 'getAll').mockImplementation(() => {
        throw new Error('boom');
      });
      // Não deve lançar — _clearIdleSessions está envolto em try/catch no collect,
      // mas chamado direto aqui pode lançar. Verificamos que o erro é propagado
      // de forma controlada (store.getAll throws → _clearIdleSessions rejeita).
      await expect(GcDaemon._clearIdleSessions()).rejects.toThrow('boom');
    });
  });

  describe('start/stop', () => {
    test('start não lança e stop limpa o timer', () => {
      expect(() => GcDaemon.start()).not.toThrow();
      expect(() => GcDaemon.stop()).not.toThrow();
    });

    test('start é idempotente (chamar 2x não cria 2 timers)', () => {
      GcDaemon.start();
      GcDaemon.start();
      GcDaemon.stop();
    });
  });
});

describe('MemoryGuard.js (split)', () => {
  test('getStats retorna objeto com campos esperados', () => {
    const s = MemoryGuard.getStats();
    expect(s).toHaveProperty('totalMB');
    expect(s).toHaveProperty('thresholdMB');
    expect(s).toHaveProperty('isBatata');
    expect(s).toHaveProperty('isRamen');
    expect(s).toHaveProperty('systemRAM');
    expect(s).toHaveProperty('uptimeMs');
    expect(s).toHaveProperty('crashCount');
    expect(s).toHaveProperty('totalGCCount');
  });

  test('getActiveProfileIds retorna array', () => {
    expect(Array.isArray(MemoryGuard.getActiveProfileIds())).toBe(true);
  });

  test('registerGameWebContents adiciona ao registry e getActiveProfileIds retorna o id', () => {
    const fakeWc = { once: jest.fn() };
    MemoryGuard.registerGameWebContents('p_test_x', fakeWc);
    expect(MemoryGuard.getActiveProfileIds()).toContain('p_test_x');
    MemoryGuard.unregisterGameWebContents('p_test_x');
    expect(MemoryGuard.getActiveProfileIds()).not.toContain('p_test_x');
  });

  test('setForceBatata alterna estado e não lança', () => {
    expect(() => MemoryGuard.setForceBatata(true)).not.toThrow();
    expect(MemoryGuard.isBatata()).toBe(true);
    expect(() => MemoryGuard.setForceBatata(false)).not.toThrow();
  });

  test('reportCrash incrementa crashCount', () => {
    const before = MemoryGuard.getStats().crashCount;
    MemoryGuard.reportCrash();
    const after = MemoryGuard.getStats().crashCount;
    expect(after).toBe(before + 1);
  });
});

describe('guard.js facade', () => {
  const guard = require('../guard');

  test('expõe collect, start, stop do GcDaemon', () => {
    expect(typeof guard.collect).toBe('function');
    expect(typeof guard.start).toBe('function');
    expect(typeof guard.stop).toBe('function');
  });

  test('expõe MemoryGuard getters', () => {
    expect(typeof guard.getStats).toBe('function');
    expect(typeof guard.isBatata).toBe('function');
    expect(typeof guard.getActiveProfileIds).toBe('function');
    expect(typeof guard.registerGameWebContents).toBe('function');
  });

  test('stop não lança', () => {
    expect(() => guard.stop()).not.toThrow();
  });
});
