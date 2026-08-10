'use strict';

(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.VisionAuthorApp = exported;
})(typeof window === 'object' ? window : null, function () {
  const INTERVAL_MS = 1000;

  function createDefaultTimers(host) {
    const timerHost = host || (typeof window === 'object' ? window : globalThis);
    if (!timerHost || typeof timerHost.setInterval !== 'function' || typeof timerHost.clearInterval !== 'function') {
      throw new TypeError('timer host is required');
    }
    return Object.freeze({
      setInterval: function (callback, delay) {
        return timerHost.setInterval(callback, delay);
      },
      clearInterval: function (interval) {
        return timerHost.clearInterval(interval);
      }
    });
  }

  function fitImageBox(container, imageSize) {
    if (!container || !imageSize || container.width <= 0 || container.height <= 0 || imageSize.width <= 0 || imageSize.height <= 0) {
      return null;
    }
    const scale = Math.min(container.width / imageSize.width, container.height / imageSize.height);
    const rawWidth = imageSize.width * scale;
    const rawHeight = imageSize.height * scale;
    const width = Math.abs(rawWidth - container.width) < 1e-9 ? container.width : rawWidth;
    const height = Math.abs(rawHeight - container.height) < 1e-9 ? container.height : rawHeight;
    return {
      left: container.left + (container.width - width) / 2,
      top: container.top + (container.height - height) / 2,
      width: width,
      height: height
    };
  }

  function mapDragToRect(start, end, box, imageSize) {
    if (!start || !end || !box || !imageSize || box.width <= 0 || box.height <= 0) return null;
    function inside(point) {
      return Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= box.left && point.x <= box.left + box.width &&
        point.y >= box.top && point.y <= box.top + box.height;
    }
    if (!inside(start) || !inside(end)) return null;
    const startX = (start.x - box.left) * imageSize.width / box.width;
    const startY = (start.y - box.top) * imageSize.height / box.height;
    const endX = (end.x - box.left) * imageSize.width / box.width;
    const endY = (end.y - box.top) * imageSize.height / box.height;
    const left = Math.max(0, Math.floor(Math.min(startX, endX)));
    const top = Math.max(0, Math.floor(Math.min(startY, endY)));
    const right = Math.min(imageSize.width, Math.ceil(Math.max(startX, endX)));
    const bottom = Math.min(imageSize.height, Math.ceil(Math.max(startY, endY)));
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function validSelection(rect, imageSize) {
    return !!rect && !!imageSize &&
      Number.isInteger(rect.x) && rect.x >= 0 &&
      Number.isInteger(rect.y) && rect.y >= 0 &&
      Number.isInteger(rect.width) && rect.width > 0 &&
      Number.isInteger(rect.height) && rect.height > 0 &&
      rect.x + rect.width <= imageSize.width && rect.y + rect.height <= imageSize.height;
  }

  function validTemplateId(templateId) {
    return typeof templateId === 'string' && templateId.length >= 1 && templateId.length <= 64 &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId);
  }

  function suggestTemplateId(templateId) {
    if (typeof templateId !== 'string') return null;
    const suggestion = templateId.trim().toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return suggestion !== templateId && validTemplateId(suggestion) ? suggestion : null;
  }

  function templateIdHelpText(templateId) {
    if (!templateId) return '必填：1–64 位小写字母、数字和单连字符。';
    if (validTemplateId(templateId)) return '将保存为 ' + templateId + '.png';
    const suggestion = suggestTemplateId(templateId);
    const reason = templateId.indexOf('_') !== -1
      ? '不能使用下划线，请使用单连字符。'
      : '仅允许 1–64 位小写字母、数字和分隔非空段的单连字符。';
    return '格式无效：' + reason + (suggestion ? ' 建议改为 ' + suggestion + '。' : '');
  }

  function formatRoi(roi) {
    if (!validSelection(roi, { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER })) {
      throw safeError(null, 'selection-invalid');
    }
    return '{ x: ' + roi.x + ', y: ' + roi.y + ', width: ' + roi.width + ', height: ' + roi.height + ' }';
  }

  function generateVisionExamples(templateId, roi) {
    if (!validTemplateId(templateId)) throw safeError(null, 'template-id-invalid');
    const literal = JSON.stringify(templateId);
    const roiLine = roi ? '  roi: ' + formatRoi(roi) + ',\n' : '';
    return {
      find: 'const match = await context.vision.find(' + literal + ', {\n' +
        roiLine + '  threshold: 0.95\n});',
      waitFor: 'await context.vision.waitFor(' + literal + ', {\n' +
        roiLine + '  threshold: 0.95,\n  timeoutMs: 10000,\n  pollIntervalMs: 250\n});'
    };
  }

  function copyTextSafely(bridge, text) {
    if (!bridge || typeof bridge.copyText !== 'function' || typeof text !== 'string') {
      return Promise.reject(safeError(null, 'clipboard-failed'));
    }
    return Promise.resolve(bridge.copyText(text));
  }

  function createCopyFeedback(options) {
    const opts = options || {};
    if (!opts.button || typeof opts.copy !== 'function') {
      throw new TypeError('button and copy are required');
    }
    const button = opts.button;
    const defaultLabel = button.textContent;
    const setTimer = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
    const clearTimer = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
    const durationMs = Number.isInteger(opts.durationMs) && opts.durationMs > 0
      ? opts.durationMs
      : 1500;
    let timer = null;
    let generation = 0;

    function reset() {
      generation += 1;
      if (timer !== null) clearTimer(timer);
      timer = null;
      button.textContent = defaultLabel;
    }

    function show(label, token) {
      if (token !== generation) return;
      button.textContent = label;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(function () {
        if (token !== generation) return;
        timer = null;
        button.textContent = defaultLabel;
      }, durationMs);
    }

    function trigger() {
      generation += 1;
      const token = generation;
      if (timer !== null) clearTimer(timer);
      timer = null;
      button.textContent = defaultLabel;
      return Promise.resolve().then(opts.copy).then(function (result) {
        show('已复制', token);
        return result;
      }, function () {
        show('复制失败', token);
      });
    }

    return Object.freeze({ reset: reset, trigger: trigger });
  }

  function safeError(error, fallbackCode) {
    if (error && typeof error.code === 'string') {
      return {
        code: error.code,
        safeMessage: typeof error.safeMessage === 'string' ? error.safeMessage : '操作失败。',
        recovery: typeof error.recovery === 'string' ? error.recovery : '刷新状态后重试。'
      };
    }
    return { code: fallbackCode || 'capture-failed', safeMessage: '操作失败。', recovery: '刷新状态后重试。' };
  }

  function createLiveController(options) {
    const opts = options || {};
    if (!opts.bridge || typeof opts.bridge.capture !== 'function') throw new TypeError('bridge is required');
    const timers = opts.timers || createDefaultTimers();
    const listeners = new Set();
    let interval = null;
    let viewEpoch = 0;
    let state = {
      mode: 'DISCONNECTED',
      selectedProfileId: null,
      selectionEpoch: 0,
      capturePending: false,
      intervalMs: INTERVAL_MS,
      scheduledTickCount: 0,
      startedCaptureCount: 0,
      skippedTickCount: 0,
      displayedFrameId: null,
      frozenFrameId: null,
      currentFrame: null,
      draft: {},
      referenceOnly: false,
      error: null
    };

    function emit() {
      listeners.forEach(function (listener) { listener(getState()); });
    }

    function update(values) {
      state = Object.assign({}, state, values);
      emit();
    }

    function getState() {
      return Object.assign({}, state, { draft: Object.assign({}, state.draft) });
    }

    function stopTicker() {
      if (interval !== null) timers.clearInterval(interval);
      interval = null;
    }

    function startTicker() {
      stopTicker();
      interval = timers.setInterval(tick, INTERVAL_MS);
    }

    function acceptFrame(result, identity) {
      const frame = result && result.frame;
      if (
        state.mode !== 'LIVE' ||
        identity.viewEpoch !== viewEpoch ||
        identity.profileId !== state.selectedProfileId ||
        identity.selectionEpoch !== state.selectionEpoch ||
        !frame ||
        !frame.profile ||
        frame.profile.id !== identity.profileId ||
        frame.selectionEpoch !== identity.selectionEpoch
      ) {
        if (frame && frame.frameId && typeof opts.bridge.releaseFrame === 'function') {
          opts.bridge.releaseFrame({ frameId: frame.frameId }).catch(function () {});
        }
        return Promise.resolve();
      }
      return Promise.resolve(opts.bridge.markDisplayed({
        frameId: frame.frameId,
        profileId: identity.profileId,
        selectionEpoch: identity.selectionEpoch
      })).then(function (ack) {
        if (
          state.mode === 'LIVE' && identity.viewEpoch === viewEpoch &&
          ack && ack.displayedFrameId === frame.frameId
        ) {
          update({ displayedFrameId: frame.frameId, currentFrame: frame, error: null });
        }
      });
    }

    function tick() {
      if (state.mode !== 'LIVE') return;
      update({ scheduledTickCount: state.scheduledTickCount + 1 });
      if (state.capturePending) {
        update({ skippedTickCount: state.skippedTickCount + 1 });
        return;
      }
      const identity = {
        profileId: state.selectedProfileId,
        selectionEpoch: state.selectionEpoch,
        viewEpoch: viewEpoch
      };
      update({
        capturePending: true,
        startedCaptureCount: state.startedCaptureCount + 1
      });
      Promise.resolve(opts.bridge.capture({
        profileId: identity.profileId,
        selectionEpoch: identity.selectionEpoch
      })).then(
        function (result) {
          update({ capturePending: false });
          return acceptFrame(result, identity);
        },
        function (error) {
          update({ capturePending: false });
          if (identity.viewEpoch === viewEpoch && state.mode === 'LIVE') {
            update({ error: safeError(error, 'capture-failed') });
          }
        }
      );
    }

    function selectProfile(profileId) {
      if (typeof profileId !== 'string' || !profileId) return;
      stopTicker();
      viewEpoch += 1;
      const previousFrozen = state.frozenFrameId;
      if (previousFrozen && typeof opts.bridge.releaseFrame === 'function') {
        opts.bridge.releaseFrame({ frameId: previousFrozen }).catch(function () {});
      }
      update({
        mode: 'LIVE',
        selectedProfileId: profileId,
        selectionEpoch: state.selectionEpoch + 1,
        displayedFrameId: null,
        frozenFrameId: null,
        currentFrame: null,
        referenceOnly: Object.keys(state.draft).length > 0,
        error: null
      });
      tick();
      startTicker();
    }

    function freeze() {
      if (state.mode === 'FROZEN') return Promise.resolve(getState());
      if (state.mode !== 'LIVE' || !state.displayedFrameId) {
        return Promise.reject(safeError(null, 'frame-stale'));
      }
      stopTicker();
      viewEpoch += 1;
      const identity = {
        frameId: state.displayedFrameId,
        profileId: state.selectedProfileId,
        selectionEpoch: state.selectionEpoch
      };
      update({ mode: 'FREEZING' });
      return Promise.resolve(opts.bridge.freezeFrame(identity)).then(function (result) {
        if (!result || !result.frame || result.frame.frameId !== identity.frameId) {
          throw safeError(null, 'frame-stale');
        }
        update({ mode: 'FROZEN', frozenFrameId: identity.frameId, referenceOnly: false, error: null });
        return getState();
      }, function (error) {
        update({ mode: 'LIVE', error: safeError(error, 'frame-stale') });
        startTicker();
        throw error;
      });
    }

    function resume() {
      if (state.mode !== 'FROZEN') return Promise.resolve(getState());
      const frameId = state.frozenFrameId;
      return Promise.resolve(opts.bridge.releaseFrame({ frameId: frameId })).catch(function () {
        return { released: false };
      }).then(function () {
        viewEpoch += 1;
        update({
          mode: 'LIVE',
          selectionEpoch: state.selectionEpoch + 1,
          displayedFrameId: null,
          frozenFrameId: null,
          currentFrame: null,
          referenceOnly: Object.keys(state.draft).length > 0,
          error: null
        });
        tick();
        startTicker();
        return getState();
      });
    }

    function disconnect(error) {
      stopTicker();
      viewEpoch += 1;
      update({
        mode: 'DISCONNECTED',
        capturePending: false,
        frozenFrameId: null,
        referenceOnly: Object.keys(state.draft).length > 0,
        error: safeError(error, 'connection-closed')
      });
    }

    function setDraftReference(values) {
      update({ draft: Object.assign({}, state.draft, values || {}) });
    }

    function setSelection(kind, rect) {
      if (kind !== 'template' && kind !== 'roi') throw safeError(null, 'selection-invalid');
      if (state.mode !== 'FROZEN' || !state.frozenFrameId || !state.currentFrame || !validSelection(rect, state.currentFrame.imageSize)) {
        throw safeError(null, 'selection-invalid');
      }
      const selection = Object.assign({}, rect, {
        frozenFrameId: state.frozenFrameId,
        referenceOnly: false
      });
      const draft = Object.assign({}, state.draft);
      draft[kind] = selection;
      if (kind === 'template') {
        draft.previewId = null;
        draft.preview = null;
      }
      update({ draft: draft, referenceOnly: false });
      return selection;
    }

    function createPreview() {
      const template = state.draft.template;
      if (
        state.mode !== 'FROZEN' || !template ||
        template.frozenFrameId !== state.frozenFrameId ||
        typeof opts.bridge.createPreview !== 'function'
      ) {
        return Promise.reject(safeError(null, 'preview-stale'));
      }
      const identity = state.frozenFrameId;
      return Promise.resolve(opts.bridge.createPreview({
        frozenFrameId: identity,
        templateRect: { x: template.x, y: template.y, width: template.width, height: template.height }
      })).then(function (result) {
        if (!result || !result.preview || state.frozenFrameId !== identity) {
          throw safeError(null, 'preview-stale');
        }
        const draft = Object.assign({}, state.draft, {
          previewId: result.preview.previewId,
          preview: result.preview
        });
        update({ draft: draft });
        return result.preview;
      });
    }

    function setTargetScript(scriptId) {
      update({ draft: Object.assign({}, state.draft, { targetScriptId: scriptId || null }) });
    }

    function setTemplateId(templateId) {
      update({ draft: Object.assign({}, state.draft, { templateId: templateId || '' }) });
    }

    function outputTexts() {
      const templateId = state.draft.templateId;
      if (!validTemplateId(templateId)) return { roi: '', find: '', waitFor: '' };
      const roi = state.draft.roi || null;
      const examples = generateVisionExamples(templateId, roi);
      return { roi: roi ? formatRoi(roi) : '', find: examples.find, waitFor: examples.waitFor };
    }

    function savePreflight() {
      if (!validTemplateId(state.draft.templateId)) {
        return Promise.reject(safeError(null, 'template-id-invalid'));
      }
      if (
        state.mode !== 'FROZEN' || state.referenceOnly || !state.frozenFrameId ||
        !state.draft.previewId || !state.draft.targetScriptId ||
        !state.currentFrame || !state.currentFrame.contract.valid
      ) {
        return Promise.reject(safeError(null, 'frame-stale'));
      }
      return opts.bridge.savePreflight({
        frozenFrameId: state.frozenFrameId,
        previewId: state.draft.previewId,
        scriptId: state.draft.targetScriptId,
        templateId: state.draft.templateId
      });
    }

    function saveCommit(replacementGrant) {
      const request = {
        frozenFrameId: state.frozenFrameId,
        previewId: state.draft.previewId,
        scriptId: state.draft.targetScriptId,
        templateId: state.draft.templateId
      };
      if (replacementGrant) request.replacementGrant = replacementGrant;
      return opts.bridge.saveCommit(request);
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.add(listener);
      listener(getState());
      return function () { listeners.delete(listener); };
    }

    return Object.freeze({
      disconnect: disconnect,
      createPreview: createPreview,
      freeze: freeze,
      getState: getState,
      resume: resume,
      saveCommit: saveCommit,
      savePreflight: savePreflight,
      selectProfile: selectProfile,
      setSelection: setSelection,
      setTargetScript: setTargetScript,
      setTemplateId: setTemplateId,
      setDraftReference: setDraftReference,
      subscribe: subscribe,
      tick: tick,
      outputTexts: outputTexts
    });
  }

  function formatSize(size) {
    return size && Number.isInteger(size.width) && Number.isInteger(size.height)
      ? size.width + ' × ' + size.height
      : '—';
  }

  function refreshProfileOptions(document, bridge, select) {
    if (!document || !bridge || typeof bridge.listProfiles !== 'function' || !select) {
      return Promise.reject(safeError(null, 'connection-closed'));
    }
    const selectedValue = select.value;
    return Promise.resolve(bridge.listProfiles()).then(function (result) {
      while (select.options.length > 1) select.remove(select.options.length - 1);
      const profiles = result && Array.isArray(result.profiles) ? result.profiles : [];
      profiles.forEach(function (option) {
        const element = document.createElement('option');
        element.value = option.id;
        element.textContent = option.name + (option.available ? '' : '（不可用）');
        element.disabled = !option.available;
        select.appendChild(element);
      });
      if (profiles.some(function (option) { return option.id === selectedValue; })) {
        select.value = selectedValue;
      } else {
        select.value = '';
      }
      return profiles;
    });
  }

  function initializeRenderer(document, bridge) {
    const profileSelect = document.getElementById('profile-select');
    const refreshProfilesButton = document.getElementById('refresh-profiles');
    const image = document.getElementById('capture-image');
    const empty = document.getElementById('capture-empty');
    const freezeButton = document.getElementById('freeze-button');
    const resumeButton = document.getElementById('resume-button');
    const status = document.getElementById('status-value');
    const profile = document.getElementById('profile-value');
    const imageSize = document.getElementById('image-size-value');
    const contentSize = document.getElementById('content-size-value');
    const capturedAt = document.getElementById('captured-at-value');
    const contract = document.getElementById('contract-value');
    const error = document.getElementById('error-panel');
    const viewer = document.getElementById('viewer');
    const templateButton = document.getElementById('template-mode');
    const roiButton = document.getElementById('roi-mode');
    const templateOverlay = document.getElementById('template-overlay');
    const roiOverlay = document.getElementById('roi-overlay');
    const templateValue = document.getElementById('template-value');
    const roiValue = document.getElementById('roi-value');
    const previewImage = document.getElementById('preview-image');
    const scriptSelect = document.getElementById('script-select');
    const templateIdInput = document.getElementById('template-id');
    const templateIdHelp = document.getElementById('template-id-help');
    const saveButton = document.getElementById('save-button');
    const saveResult = document.getElementById('save-result');
    const roiOutput = document.getElementById('roi-output');
    const findOutput = document.getElementById('find-output');
    const waitOutput = document.getElementById('wait-output');
    let selectionMode = null;
    let activeDrag = null;
    let renderedFrameId = null;
    const controller = createLiveController({ bridge: bridge });

    function refreshProfiles() {
      refreshProfilesButton.disabled = true;
      return refreshProfileOptions(document, bridge, profileSelect).then(function (profiles) {
        refreshProfilesButton.disabled = false;
        return profiles;
      }, function (failure) {
        refreshProfilesButton.disabled = false;
        controller.disconnect(failure);
        throw failure;
      });
    }

    refreshProfiles().catch(function () {});
    bridge.listScripts().then(function (result) {
      (result.scripts || []).forEach(function (option) {
        const element = document.createElement('option');
        element.value = option.id;
        element.textContent = option.name + ' (' + option.id + ')';
        scriptSelect.appendChild(element);
      });
    }).catch(function () {});

    profileSelect.addEventListener('change', function () {
      if (profileSelect.value) controller.selectProfile(profileSelect.value);
    });
    refreshProfilesButton.addEventListener('click', function () { refreshProfiles().catch(function () {}); });
    freezeButton.addEventListener('click', function () { controller.freeze().catch(function () {}); });
    resumeButton.addEventListener('click', function () { controller.resume(); });
    templateButton.addEventListener('click', function () { selectionMode = 'template'; });
    roiButton.addEventListener('click', function () { selectionMode = 'roi'; });
    scriptSelect.addEventListener('change', function () { controller.setTargetScript(scriptSelect.value); });
    templateIdInput.addEventListener('input', function () { controller.setTemplateId(templateIdInput.value); });
    saveButton.addEventListener('click', function () {
      controller.savePreflight().then(function (preflight) {
        if (preflight.status === 'confirmation-required') {
          const confirmed = window.confirm('替换 ' + preflight.relativePath + '？');
          if (!confirmed) return null;
          return controller.saveCommit(preflight.replacementGrant);
        }
        return controller.saveCommit();
      }).then(function (saved) {
        if (saved) saveResult.textContent = '已保存：' + saved.relativePath;
      }).catch(function (failure) {
        saveResult.textContent = failure.safeMessage || '保存失败。';
      });
    });
    const copyFeedbacks = [];
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      const target = document.getElementById(button.dataset.copy);
      const feedback = createCopyFeedback({
        button: button,
        copy: function () { return copyTextSafely(bridge, target.textContent); }
      });
      copyFeedbacks.push(feedback);
      button.addEventListener('click', feedback.trigger);
    });
    let outputSignature = null;

    function renderSelection(selection, overlay, value, state, transient) {
      if (!selection || !state || !state.currentFrame) {
        overlay.hidden = true;
        value.textContent = '—';
        return;
      }
      const imageBox = image.getBoundingClientRect();
      const viewerBox = viewer.getBoundingClientRect();
      if (imageBox.width <= 0 || imageBox.height <= 0) {
        overlay.hidden = true;
        return;
      }
      const viewerClientLeft = Number.isFinite(viewer.clientLeft) ? viewer.clientLeft : 0;
      const viewerClientTop = Number.isFinite(viewer.clientTop) ? viewer.clientTop : 0;
      overlay.hidden = false;
      overlay.style.left = (imageBox.left - viewerBox.left - viewerClientLeft +
        selection.x / state.currentFrame.imageSize.width * imageBox.width) + 'px';
      overlay.style.top = (imageBox.top - viewerBox.top - viewerClientTop +
        selection.y / state.currentFrame.imageSize.height * imageBox.height) + 'px';
      overlay.style.width = (selection.width / state.currentFrame.imageSize.width * imageBox.width) + 'px';
      overlay.style.height = (selection.height / state.currentFrame.imageSize.height * imageBox.height) + 'px';
      value.textContent = '{ x: ' + selection.x + ', y: ' + selection.y + ', width: ' + selection.width + ', height: ' + selection.height + ' }' +
        (transient ? '（拖动中）' : (selection.referenceOnly || state.referenceOnly ? '（仅供参考）' : ''));
    }

    function renderDraftSelections(state) {
      renderSelection(state.draft.template, templateOverlay, templateValue, state, false);
      renderSelection(state.draft.roi, roiOverlay, roiValue, state, false);
    }

    function rectForDrag(drag) {
      const state = controller.getState();
      if (!drag || !state.currentFrame) return null;
      const imageBox = image.getBoundingClientRect();
      return mapDragToRect(
        drag.start,
        drag.end,
        { left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height },
        state.currentFrame.imageSize
      );
    }

    function renderActiveDrag() {
      if (!activeDrag || !activeDrag.ready) return;
      const state = controller.getState();
      const rect = rectForDrag(activeDrag);
      if (!rect) return;
      if (activeDrag.kind === 'template') {
        renderSelection(rect, templateOverlay, templateValue, state, true);
      } else {
        renderSelection(rect, roiOverlay, roiValue, state, true);
      }
    }

    function restoreCommittedSelections() {
      renderDraftSelections(controller.getState());
    }

    function finishActiveDrag() {
      if (!activeDrag || !activeDrag.ready || !activeDrag.released) return;
      const drag = activeDrag;
      const rect = rectForDrag(drag);
      activeDrag = null;
      restoreCommittedSelections();
      if (!rect) return;
      controller.setSelection(drag.kind, rect);
      if (drag.kind === 'template') controller.createPreview().catch(function () {});
    }

    viewer.addEventListener('pointerdown', function (event) {
      const state = controller.getState();
      if (activeDrag || !selectionMode || !state.currentFrame) return;
      const drag = {
        start: { x: event.clientX, y: event.clientY },
        end: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId,
        kind: selectionMode,
        ready: false,
        released: false
      };
      activeDrag = drag;
      if (typeof viewer.setPointerCapture === 'function') viewer.setPointerCapture(event.pointerId);
      const begin = state.mode === 'FROZEN' ? Promise.resolve() : controller.freeze();
      begin.then(function () {
        if (activeDrag !== drag) return;
        drag.ready = true;
        renderActiveDrag();
        finishActiveDrag();
      }).catch(function () {
        if (activeDrag === drag) activeDrag = null;
        restoreCommittedSelections();
      });
    });
    viewer.addEventListener('pointermove', function (event) {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      activeDrag.end = { x: event.clientX, y: event.clientY };
      renderActiveDrag();
    });
    viewer.addEventListener('pointerup', function (event) {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      activeDrag.end = { x: event.clientX, y: event.clientY };
      activeDrag.released = true;
      if (typeof viewer.releasePointerCapture === 'function') {
        try { viewer.releasePointerCapture(event.pointerId); } catch (_) { /* pointer capture already released */ }
      }
      finishActiveDrag();
    });
    viewer.addEventListener('pointercancel', function (event) {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      activeDrag = null;
      restoreCommittedSelections();
    });
    image.addEventListener('load', function () {
      restoreCommittedSelections();
      if (activeDrag && activeDrag.ready) renderActiveDrag();
    });
    bridge.onDisconnected(function (failure) { controller.disconnect(failure); });

    controller.subscribe(function (state) {
      const modeText = state.mode === 'LIVE'
        ? '实时画面'
        : state.mode === 'FROZEN' ? '已冻结' : '未连接';
      status.textContent = modeText + (state.capturePending ? ' · 正在截图' : '');
      const targetUnavailable = !!(state.error && (
        state.error.code === 'profile-unavailable' || state.error.code === 'connection-closed'
      ));
      freezeButton.disabled = state.mode !== 'LIVE' || !state.displayedFrameId || targetUnavailable;
      resumeButton.disabled = state.mode !== 'FROZEN';
      const frame = state.currentFrame;
      if (frame) {
        if (frame.frameId !== renderedFrameId) {
          renderedFrameId = frame.frameId;
          image.src = frame.pngDataUrl;
        }
        image.hidden = false;
        empty.hidden = true;
        profile.textContent = frame.profile.name + ' (' + frame.profile.id + ')';
        imageSize.textContent = formatSize(frame.imageSize);
        contentSize.textContent = formatSize(frame.contentSize);
        capturedAt.textContent = new Date(frame.capturedAt).toLocaleString();
        contract.textContent = frame.contract.valid
          ? '有效'
          : '无效（' + frame.contract.failures.length + ' 项）';
        contract.dataset.valid = String(frame.contract.valid);
      }
      error.hidden = !state.error;
      error.textContent = state.error ? state.error.safeMessage + ' ' + state.error.recovery : '';
      templateButton.disabled = targetUnavailable || !state.currentFrame || (state.mode !== 'LIVE' && state.mode !== 'FROZEN');
      roiButton.disabled = templateButton.disabled;
      renderDraftSelections(state);
      if (activeDrag && activeDrag.ready) renderActiveDrag();
      if (state.draft.preview) {
        previewImage.src = state.draft.preview.pngDataUrl;
        previewImage.hidden = false;
      } else {
        previewImage.hidden = true;
      }
      const outputs = controller.outputTexts();
      roiOutput.textContent = outputs.roi;
      findOutput.textContent = outputs.find;
      waitOutput.textContent = outputs.waitFor;
      const nextOutputSignature = outputs.roi + '\u0000' + outputs.find + '\u0000' + outputs.waitFor;
      if (outputSignature !== null && outputSignature !== nextOutputSignature) {
        copyFeedbacks.forEach(function (feedback) { feedback.reset(); });
      }
      outputSignature = nextOutputSignature;
      const currentTemplateId = state.draft.templateId || '';
      const templateIdValid = validTemplateId(currentTemplateId);
      templateIdInput.dataset.valid = currentTemplateId ? String(templateIdValid) : '';
      templateIdHelp.dataset.valid = currentTemplateId ? String(templateIdValid) : '';
      templateIdHelp.textContent = templateIdHelpText(currentTemplateId);
      saveButton.disabled = !(
        state.mode === 'FROZEN' && !state.referenceOnly && state.draft.previewId &&
        state.draft.targetScriptId && templateIdValid &&
        state.currentFrame && state.currentFrame.contract.valid && !targetUnavailable
      );
    });
    return controller;
  }

  if (typeof window === 'object' && window.document && window.visionAuthor) {
    window.addEventListener('DOMContentLoaded', function () {
      initializeRenderer(window.document, window.visionAuthor);
    });
  }

  return {
    INTERVAL_MS: INTERVAL_MS,
    createDefaultTimers: createDefaultTimers,
    createCopyFeedback: createCopyFeedback,
    createLiveController: createLiveController,
    copyTextSafely: copyTextSafely,
    fitImageBox: fitImageBox,
    formatRoi: formatRoi,
    generateVisionExamples: generateVisionExamples,
    initializeRenderer: initializeRenderer,
    mapDragToRect: mapDragToRect,
    refreshProfileOptions: refreshProfileOptions,
    safeError: safeError,
    suggestTemplateId: suggestTemplateId,
    templateIdHelpText: templateIdHelpText,
    validTemplateId: validTemplateId
  };
});
