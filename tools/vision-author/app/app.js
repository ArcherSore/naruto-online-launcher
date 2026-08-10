'use strict';

(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.VisionAuthorApp = exported;
})(typeof window === 'object' ? window : null, function () {
  const INTERVAL_MS = 1000;

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
    const timers = opts.timers || {
      setInterval: setInterval,
      clearInterval: clearInterval
    };
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
      if (
        state.mode !== 'FROZEN' || state.referenceOnly || !state.frozenFrameId ||
        !state.draft.previewId || !state.draft.targetScriptId || !validTemplateId(state.draft.templateId) ||
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

  function initializeRenderer(document, bridge) {
    const profileSelect = document.getElementById('profile-select');
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
    const saveButton = document.getElementById('save-button');
    const saveResult = document.getElementById('save-result');
    const roiOutput = document.getElementById('roi-output');
    const findOutput = document.getElementById('find-output');
    const waitOutput = document.getElementById('wait-output');
    let selectionMode = null;
    let dragStart = null;
    const controller = createLiveController({ bridge: bridge });

    bridge.listProfiles().then(function (result) {
      (result.profiles || []).forEach(function (option) {
        const element = document.createElement('option');
        element.value = option.id;
        element.textContent = option.name + (option.available ? '' : '（不可用）');
        element.disabled = !option.available;
        profileSelect.appendChild(element);
      });
    }).catch(function (failure) { controller.disconnect(failure); });
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
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        const target = document.getElementById(button.dataset.copy);
        copyTextSafely(bridge, target.textContent).then(function () {
          button.textContent = '已复制';
        }).catch(function () {
          button.textContent = '复制失败，请手工复制';
        });
      });
    });
    viewer.addEventListener('pointerdown', function (event) {
      if (!selectionMode || !controller.getState().currentFrame) return;
      const begin = controller.getState().mode === 'FROZEN' ? Promise.resolve() : controller.freeze();
      begin.then(function () {
        dragStart = { x: event.clientX, y: event.clientY };
        if (typeof viewer.setPointerCapture === 'function') viewer.setPointerCapture(event.pointerId);
      }).catch(function () {});
    });
    viewer.addEventListener('pointerup', function (event) {
      if (!dragStart || !selectionMode) return;
      const state = controller.getState();
      const imageBox = image.getBoundingClientRect();
      const rect = mapDragToRect(
        dragStart,
        { x: event.clientX, y: event.clientY },
        { left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height },
        state.currentFrame.imageSize
      );
      dragStart = null;
      if (!rect) return;
      controller.setSelection(selectionMode, rect);
      if (selectionMode === 'template') controller.createPreview().catch(function () {});
    });
    bridge.onDisconnected(function (failure) { controller.disconnect(failure); });

    controller.subscribe(function (state) {
      status.textContent = state.mode + (state.capturePending ? ' · capture pending' : '');
      const targetUnavailable = !!(state.error && (
        state.error.code === 'profile-unavailable' || state.error.code === 'connection-closed'
      ));
      freezeButton.disabled = state.mode !== 'LIVE' || !state.displayedFrameId || targetUnavailable;
      resumeButton.disabled = state.mode !== 'FROZEN';
      const frame = state.currentFrame;
      if (frame) {
        image.src = frame.pngDataUrl;
        image.hidden = false;
        empty.hidden = true;
        profile.textContent = frame.profile.name + ' (' + frame.profile.id + ')';
        imageSize.textContent = formatSize(frame.imageSize);
        contentSize.textContent = formatSize(frame.contentSize);
        capturedAt.textContent = new Date(frame.capturedAt).toLocaleString();
        contract.textContent = frame.contract.valid ? '有效' : frame.contract.failures.join(', ');
        contract.dataset.valid = String(frame.contract.valid);
      }
      error.hidden = !state.error;
      error.textContent = state.error ? state.error.safeMessage + ' ' + state.error.recovery : '';
      templateButton.disabled = targetUnavailable || !state.currentFrame || (state.mode !== 'LIVE' && state.mode !== 'FROZEN');
      roiButton.disabled = templateButton.disabled;
      function renderSelection(selection, overlay, value) {
        if (!selection || !state.currentFrame) {
          overlay.hidden = true;
          value.textContent = '—';
          return;
        }
        overlay.hidden = false;
        overlay.style.left = (selection.x / state.currentFrame.imageSize.width * 100) + '%';
        overlay.style.top = (selection.y / state.currentFrame.imageSize.height * 100) + '%';
        overlay.style.width = (selection.width / state.currentFrame.imageSize.width * 100) + '%';
        overlay.style.height = (selection.height / state.currentFrame.imageSize.height * 100) + '%';
        value.textContent = '{ x: ' + selection.x + ', y: ' + selection.y + ', width: ' + selection.width + ', height: ' + selection.height + ' }' +
          (selection.referenceOnly || state.referenceOnly ? '（reference-only）' : '');
      }
      renderSelection(state.draft.template, templateOverlay, templateValue);
      renderSelection(state.draft.roi, roiOverlay, roiValue);
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
      saveButton.disabled = !(
        state.mode === 'FROZEN' && !state.referenceOnly && state.draft.previewId &&
        state.draft.targetScriptId && validTemplateId(state.draft.templateId) &&
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
    createLiveController: createLiveController,
    copyTextSafely: copyTextSafely,
    fitImageBox: fitImageBox,
    formatRoi: formatRoi,
    generateVisionExamples: generateVisionExamples,
    initializeRenderer: initializeRenderer,
    mapDragToRect: mapDragToRect,
    safeError: safeError,
    validTemplateId: validTemplateId
  };
});
