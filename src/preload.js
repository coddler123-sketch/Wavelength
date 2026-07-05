const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb, map = (_, v) => cb(v)) {
  const handler = (...args) => map(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Send to main
  playPause: (forceState) => ipcRenderer.send('play-pause', forceState),
  togglePin: () => ipcRenderer.send('toggle-pin'),
  toggleMini: () => ipcRenderer.send('toggle-mini'),
  toggleMute: () => ipcRenderer.send('toggle-mute'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
  cycleSleepTimer: () => ipcRenderer.send('cycle-sleep-timer'),
  setConnectionState: (state) => ipcRenderer.send('connection-state', state),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  selectStation: (station, noPlay) => ipcRenderer.send('select-station', station, noPlay),
  logRendererError: (info) => ipcRenderer.send('renderer-error', info),
  cacheIcon: (url) => ipcRenderer.invoke('cache-icon', url),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (on) => ipcRenderer.send('set-autostart', on),
  getAutoUpdateEnabled: () => ipcRenderer.invoke('get-auto-update-enabled'),
  setAutoUpdateEnabled: (on) => ipcRenderer.send('set-auto-update-enabled', on),
  setLang: (lang) => ipcRenderer.send('set-lang', lang),

  // Receive from main
  onSetPlaying: (cb) => listen('set-playing', cb),
  onSetPinned: (cb) => listen('set-pinned', cb),
  onSetMini: (cb) => listen('set-mini', cb),
  onSetMuted: (cb) => listen('set-muted', cb),
  onWindowVisible: (cb) => listen('window-visible', cb),
  onSleepUpdate: (cb) => listen('sleep-update', cb),
  onSleepFade: (cb) => listen('sleep-fade', cb, () => cb()),
  onAppVersion: (cb) => listen('app-version', cb),
  onResetSettings: (cb) => listen('reset-settings', cb, () => cb()),
  onSystemIdle: (cb) => listen('system-idle', cb),
  onShowAbout: (cb) => listen('show-about', cb, () => cb()),
  onShowShortcuts: (cb) => listen('show-shortcuts', cb, () => cb()),
  onSetStation: (cb) => listen('set-station', cb),
  onTrackInfo: (cb) => listen('track-info', cb),

  // Queries
  getStations: () => ipcRenderer.invoke('get-stations'),
  getState: () => ipcRenderer.invoke('get-state'),
  checkStream: (url) => ipcRenderer.invoke('check-stream', url),
  addCustomStation: (data) => ipcRenderer.invoke('add-custom-station', data),
  updateCustomStation: (id, data) => ipcRenderer.invoke('update-custom-station', id, data),
  removeCustomStation: (id) => ipcRenderer.invoke('remove-custom-station', id),
});
