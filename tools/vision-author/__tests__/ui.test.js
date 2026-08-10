'use strict';

const fs = require('fs');
const path = require('path');

describe('脚本截图工具界面', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');

  test('keeps the capture fixed while the grouped tool panel scrolls independently', () => {
    expect(html).toContain('<section class="viewer-card"');
    expect(html).toContain('<aside class="tool-panel"');
    expect(html.match(/<details class="tool-section"/g)).toHaveLength(4);
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 360px;');
    expect(css).toContain('.tool-panel');
    expect(css).toContain('overflow-y: auto;');
    expect(css).toContain('.viewer > img[hidden] { display: none; }');
    expect(css).toContain('body {');
    expect(css).toContain('overflow: hidden;');
  });

  test('uses concise Chinese UI copy while keeping ROI and API names', () => {
    ['脚本截图工具', '画面控制', '框选与预览', '保存模板', '复制代码',
      '冻结画面', '恢复实时', '模板区域', 'ROI'].forEach(function (text) {
      expect(html).toContain(text);
    });
    ['Vision Author Tool', 'Frame metadata', 'Frozen-frame selections',
      'Resume Live', '>Freeze<', 'Template rect', 'Crop preview', 'Target Script'].forEach(function (text) {
      expect(html).not.toContain(text);
    });
    expect(js).toContain("'实时画面'");
    expect(js).toContain("'已冻结'");
    expect(js).toContain('正在截图');
    expect(html).toContain('复制 find()');
    expect(html).toContain('复制 waitFor()');
  });

  test('restores all three copy labels after temporary feedback', () => {
    expect(html.match(/data-copy=/g)).toHaveLength(3);
    expect(js).toContain("show('已复制', token)");
    expect(js).toContain("show('复制失败', token)");
    expect(js).toContain(': 1500;');
    expect(js).toContain('copyFeedbacks.forEach(function (feedback) { feedback.reset(); });');
  });
});
