'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const DemoCoordinateStore = require('../DemoCoordinateStore');

describe('DemoCoordinateStore', () => {
  const originalDebug = process.env.SHINOBI_DEBUG;
  let baseDir;

  beforeEach(() => {
    process.env.SHINOBI_DEBUG = '1';
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'naruto-demo-click-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalDebug === undefined) delete process.env.SHINOBI_DEBUG;
    else process.env.SHINOBI_DEBUG = originalDebug;
  });

  test('按顺序自动保存最多两个归一化坐标到 Profile 专用 JSON', async () => {
    const options = { baseDir: baseDir };
    await DemoCoordinateStore.reset('p_001', options);
    await DemoCoordinateStore.append('p_001', { normalizedX: 0.25, normalizedY: 0.5 }, options);
    const recording = await DemoCoordinateStore.append(
      'p_001',
      { normalizedX: 0.75, normalizedY: 0.6 },
      options
    );

    expect(recording.points).toEqual([
      { order: 1, normalizedX: 0.25, normalizedY: 0.5 },
      { order: 2, normalizedX: 0.75, normalizedY: 0.6 }
    ]);
    const filePath = DemoCoordinateStore.getFilePath('p_001', options);
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(saved).toEqual(
      expect.objectContaining({ scriptId: 'demo-click', points: recording.points })
    );
    await expect(
      DemoCoordinateStore.append('p_001', { normalizedX: 0.1, normalizedY: 0.1 }, options)
    ).rejects.toMatchObject({ code: 'point-limit-reached' });
  });

  test('清空删除 JSON，损坏或不存在的文件按空记录处理', async () => {
    const options = { baseDir: baseDir };
    const filePath = DemoCoordinateStore.getFilePath('p_001', options);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{broken', 'utf8');

    await expect(DemoCoordinateStore.load('p_001', options)).resolves.toEqual(
      expect.objectContaining({ points: [] })
    );
    await DemoCoordinateStore.reset('p_001', options);
    await expect(DemoCoordinateStore.clear('p_001', options)).resolves.toEqual(
      expect.objectContaining({ points: [] })
    );
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('非 Debug 环境拒绝读写', async () => {
    delete process.env.SHINOBI_DEBUG;
    await expect(DemoCoordinateStore.load('p_001', { baseDir: baseDir })).rejects.toMatchObject({
      code: 'debug-disabled'
    });
  });
});
