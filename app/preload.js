// Q-CUBIC Remote - safe bridge between the host window and the app
// Copyright (c) 2026 Pruthvi. All rights reserved.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qcr', {
  info: () => ipcRenderer.invoke('info'),
  addTrusted: (t) => ipcRenderer.invoke('add-trusted', t),
  clearTrusted: () => ipcRenderer.invoke('clear-trusted'),
  qos: (op, args) => ipcRenderer.invoke('qos', op, args),
  turn: () => ipcRenderer.invoke('turn'),
  turnLink: (link) => ipcRenderer.invoke('turn-link', link),
  awake: (on) => ipcRenderer.send('awake', !!on),
  sendInput: (ev) => ipcRenderer.send('input', ev),
  log: (text) => ipcRenderer.send('log', String(text)),
});
