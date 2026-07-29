'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getMmCfgPath, appendPreloadSwf, MmCfgSession } = require('../mm');

describe('用户级 mm.cfg 临时管理', () => {
  let tempDir;
  let cfgPath;
  let stateDir;
  let swfPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-mm-cfg-'));
    cfgPath = path.join(tempDir, 'home', 'mm.cfg');
    stateDir = path.join(tempDir, 'state');
    swfPath = path.join(tempDir, 'FlashProbe.swf');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(swfPath, 'fixture');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('Windows 用户级路径是 home/mm.cfg，不是 mms.cfg', () => {
    expect(getMmCfgPath('win32', 'C:\\Users\\tester')).toBe('C:\\Users\\tester\\mm.cfg');
  });

  test('只追加 PreloadSwf 且统一路径分隔符', () => {
    expect(
      appendPreloadSwf('TraceOutputFileEnable=1', 'C:\\probe\\FlashProbe.swf', { port: 32145 })
    ).toBe(
      'TraceOutputFileEnable=1\nPreloadSwf=C:/probe/FlashProbe.swf?port=32145\n'
    );
  });

  test('修改前备份并在 restore 时逐字节恢复原文件', () => {
    const original = Buffer.from('TraceOutputFileEnable=1\r\n自定义=保留\r\n', 'utf8');
    fs.writeFileSync(cfgPath, original);
    const session = new MmCfgSession({ cfgPath: cfgPath, stateDir: stateDir });

    session.apply(swfPath);
    expect(fs.readFileSync(cfgPath, 'utf8')).toContain('PreloadSwf=');
    expect(fs.existsSync(path.join(stateDir, 'mm.cfg.original'))).toBe(true);

    expect(session.restore()).toBe(true);
    expect(fs.readFileSync(cfgPath)).toEqual(original);
    expect(fs.existsSync(path.join(stateDir, 'mm.cfg.original'))).toBe(false);
  });

  test('原本不存在时退出会删除 Demo 创建的 mm.cfg', () => {
    const session = new MmCfgSession({ cfgPath: cfgPath, stateDir: stateDir });
    session.apply(swfPath);
    expect(fs.existsSync(cfgPath)).toBe(true);

    session.restore();
    expect(fs.existsSync(cfgPath)).toBe(false);
  });

  test('SWF 不存在时不修改用户配置', () => {
    fs.writeFileSync(cfgPath, 'original', 'utf8');
    const session = new MmCfgSession({ cfgPath: cfgPath, stateDir: stateDir });

    expect(() => session.apply(path.join(tempDir, 'missing.swf'))).toThrow('probe-swf-missing');
    expect(fs.readFileSync(cfgPath, 'utf8')).toBe('original');
  });
});
