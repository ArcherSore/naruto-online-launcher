'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = Object.freeze({
  listProfiles: function () { return ipcRenderer.invoke('vision-author:profiles-list', {}); },
  listScripts: function () { return ipcRenderer.invoke('vision-author:scripts-list', {}); },
  capture: function (request) { return ipcRenderer.invoke('vision-author:capture', request); },
  markDisplayed: function (request) {
    return ipcRenderer.invoke('vision-author:frame-displayed', request);
  },
  freezeFrame: function (request) { return ipcRenderer.invoke('vision-author:frame-freeze', request); },
  releaseFrame: function (request) { return ipcRenderer.invoke('vision-author:frame-release', request); },
  createPreview: function (request) {
    return ipcRenderer.invoke('vision-author:preview-create', request);
  },
  savePreflight: function (request) {
    return ipcRenderer.invoke('vision-author:save-preflight', request);
  },
  saveCommit: function (request) { return ipcRenderer.invoke('vision-author:save-commit', request); },
  copyText: function (value) { return ipcRenderer.invoke('vision-author:clipboard-write', value); },
  onDisconnected: function (listener) {
    if (typeof listener !== 'function') return function () {};
    const wrapped = function (_event, error) { listener(error); };
    ipcRenderer.on('vision-author:disconnected', wrapped);
    return function () { ipcRenderer.removeListener('vision-author:disconnected', wrapped); };
  }
});

contextBridge.exposeInMainWorld('visionAuthor', api);

