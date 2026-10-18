const { contextBridge, ipcRenderer } = require('electron');

const subscriptions = new Set();

const api = Object.freeze({
  getProject: () => ipcRenderer.invoke('studio:get-project'),
  openProject: () => ipcRenderer.invoke('studio:open-project'),
  saveVisualConfig: (config) => ipcRenderer.invoke('studio:save-visual-config', config),
  setDirty: (dirty) => ipcRenderer.invoke('studio:set-dirty', dirty === true),
  respondToClose: (choice) => ipcRenderer.invoke('studio:respond-to-close', choice),
  closeStudio: () => ipcRenderer.invoke('studio:request-close'),
  onSaveRequest: (callback) => subscribe('studio:save-request', callback),
  onOpenProjectRequest: (callback) => subscribe('studio:open-project-request', callback),
  onHistoryCommand: (callback) => subscribe('studio:history-command', callback),
  onCloseRequest: (callback) => {
    return subscribe('studio:close-request', callback);
  },
});

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  subscriptions.add(listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
    subscriptions.delete(listener);
  };
}

contextBridge.exposeInMainWorld('trindadeStudio', api);
