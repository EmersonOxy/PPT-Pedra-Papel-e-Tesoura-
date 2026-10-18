const { contextBridge, ipcRenderer } = require('electron');

const subscriptions = new Set();

const api = Object.freeze({
  getProject: () => ipcRenderer.invoke('studio:get-project'),
  openProject: () => ipcRenderer.invoke('studio:open-project'),
  getHomeState: () => ipcRenderer.invoke('studio:get-home-state'),
  chooseProjectParent: () => ipcRenderer.invoke('studio:choose-project-parent'),
  createProject: (request) => ipcRenderer.invoke('studio:create-project', request),
  openRecentProject: (root) => ipcRenderer.invoke('studio:open-recent-project', root),
  removeRecentProject: (root) => ipcRenderer.invoke('studio:remove-recent-project', root),
  checkForUpdates: () => ipcRenderer.invoke('studio:check-updates'),
  openReleasePage: (url) => ipcRenderer.invoke('studio:open-release-page', url),
  requestHome: () => ipcRenderer.invoke('studio:request-home'),
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
  onReturnHomeRequest: (callback) => subscribe('studio:return-home-request', callback),
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
