'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('connectApp', {
  defaults: () => ipcRenderer.invoke('defaults'),
  connect: value => ipcRenderer.invoke('connect', value),
  onProgress: callback => ipcRenderer.on('progress', (_event, text) => callback(text)),
});
