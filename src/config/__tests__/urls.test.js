/**
 * Testes para src/config/urls.js (v3.5.1 — URLs reais validadas por pesquisa)
 */

const { getGameUrl, getServerlistUrl, getGameCode, getLauncherParams, REGION_URLS, LAUNCHER_PARAMS } = require('../urls');

describe('config/urls.js v3.5.1', () => {
  describe('getGameUrl', () => {
    test('região br retorna serverlist PT', () => {
      const url = getGameUrl('br');
      expect(url).toContain('naruto.narutowebgame.com/pt/serverlist');
      expect(url).toContain('logintype=4');
    });

    test('região na retorna serverlist EN', () => {
      const url = getGameUrl('na');
      expect(url).toContain('naruto.narutowebgame.com/en/serverlist');
    });

    test('região hk retorna serverlist ZH', () => {
      const url = getGameUrl('hk');
      expect(url).toContain('naruto.narutowebgame.com/zh/serverlist');
    });

    test('sem região retorna BR por padrão', () => {
      const url = getGameUrl();
      expect(url).toContain('/pt/serverlist');
    });

    test('com servidor vai direto para o servidor', () => {
      const url = getGameUrl('br', 'pt', 's799');
      expect(url).toContain('/pt/serverlist/s799');
      expect(url).toContain('logintype=4');
    });

    test('servidor sem prefixo s é normalizado', () => {
      const url = getGameUrl('br', 'pt', '799');
      expect(url).toContain('/pt/serverlist/s799');
    });

    test('servidor maiúsculo é normalizado', () => {
      const url = getGameUrl('br', 'pt', 'S799');
      expect(url).toContain('/pt/serverlist/s799');
    });

    test('região inválida retorna BR', () => {
      const url = getGameUrl('xx');
      expect(url).toContain('/pt/serverlist');
    });

    test('inclui logintype=4 (reconhecimento de launcher)', () => {
      const url = getGameUrl('br');
      expect(url).toContain('logintype=4');
    });

    test('inclui launcher=shinobi (identificação do client)', () => {
      const url = getGameUrl('br');
      expect(url).toContain('launcher=shinobi');
    });
  });

  describe('getServerlistUrl', () => {
    test('retorna URL base de serverlist para região', () => {
      expect(getServerlistUrl('br')).toBe('https://naruto.narutowebgame.com/pt/serverlist');
      expect(getServerlistUrl('na')).toBe('https://naruto.narutowebgame.com/en/serverlist');
    });
  });

  describe('getGameCode', () => {
    test('retorna GameCode correto por região', () => {
      expect(getGameCode('br')).toBe('narutopt');
      expect(getGameCode('na')).toBe('narutoen');
      expect(getGameCode('hk')).toBe('narutozh');
    });
  });

  describe('getLauncherParams', () => {
    test('retorna parâmetros de launcher', () => {
      const params = getLauncherParams();
      expect(params).toContain('logintype=4');
      expect(params).toContain('launcher=shinobi');
    });
  });

  describe('constants', () => {
    test('REGION_URLS tem 8 regiões com narutowebgame.com', () => {
      expect(Object.keys(REGION_URLS)).toHaveLength(8);
      Object.values(REGION_URLS).forEach(url => {
        expect(url).toContain('naruto.narutowebgame.com');
        expect(url).toContain('serverlist');
      });
    });

    test('LAUNCHER_PARAMS inclui logintype=4', () => {
      expect(LAUNCHER_PARAMS).toContain('logintype=4');
    });
  });
});
