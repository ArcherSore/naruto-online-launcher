'use strict';

const fs = require('fs');
const path = require('path');

describe('manager automation panel assets', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  test('contains only the release script catalog and run controls', () => {
    expect(html).toContain('id="automationModal"');
    expect(html).toContain('id="automationScriptList"');
    expect(html).toContain('id="automationProfileSummary"');
    ['automationCapture', 'automationRecordBtn', 'automationClearBtn',
      'automationVisionSelectBtn', 'automationVisionMatchBtn'].forEach(function (id) {
      expect(html).not.toContain('id="' + id + '"');
    });
    expect(html).not.toContain('截图录点');
    expect(html).not.toContain('清空坐标');
    expect(html).not.toContain('Vision 框选');
  });

  test('shows six cards in a two-column, three-row scroll viewport', () => {
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('grid-auto-rows: 126px;');
    expect(css).toContain('max-height: 398px;');
    expect(css).toContain('overflow-y: auto;');
    expect(css).toContain('@media (max-width: 760px)');
    expect(js).toContain('automation-script-description');
    expect(js).toContain('automation-status-');
  });

  test('runs a script directly from its card through release channels only', () => {
    ['automation:list', 'automation:start', 'automation:stop'].forEach(function (channel) {
      expect(js).toContain("'" + channel + "'");
    });
    ['automation:recording:begin', 'automation:recording:add-point',
      'automation:vision:templates', 'automation:vision:test',
      'automation:coordinates:get', 'automation:coordinates:clear'].forEach(function (channel) {
      expect(js).not.toContain("'" + channel + "'");
    });
    expect(js).toContain("button.closest('[data-script-id]')");
    expect(js).not.toContain('automationSelectedScriptId');
  });

  test('uses target availability for start while keeping readiness diagnostic', () => {
    expect(js).toContain('const runnable = automationTarget.available === true;');
    expect(js).not.toContain(
      'const runnable = automationTarget.available === true && automationTarget.gameReady === true;'
    );
    expect(js).toContain("ipcRenderer.on('launch-flow:status'");
    expect(js).toContain("state.stage === 'GAME_READY'");
  });

  test('renders stop/stopping, status snapshots, and safe run recovery text', () => {
    expect(js).toContain("stopping: '停止中'");
    expect(js).toContain("ipcRenderer.on('automation:status'");
    expect(js).toContain("ipcRenderer.on('automation:statuses'");
    ['profile-busy', 'cdp-already-attached', 'run-timeout', 'window-unavailable',
      'vision-template-not-found', 'vision-timeout'].forEach(function (code) {
      expect(js).toContain("'" + code + "'");
    });
  });

  test('updates availability for the active Profile when its game window changes', () => {
    expect(js).toContain('state.profileId === automationProfileId');
    expect(js).toContain('automationTarget.available = state.open === true');
  });
});
