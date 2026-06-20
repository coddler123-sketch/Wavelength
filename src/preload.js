const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Send to main
  playPause:    (forceState) => ipcRenderer.send('play-pause', forceState),
  togglePin:    () => ipcRenderer.send('toggle-pin'),
  toggleMini:   () => ipcRenderer.send('toggle-mini'),
  toggleMute:   () => ipcRenderer.send('toggle-mute'),
  hideWindow:        () => ipcRenderer.send('hide-window'),
  quitApp:           () => ipcRenderer.send('quit-app'),
  cycleSleepTimer:   () => ipcRenderer.send('cycle-sleep-timer'),
  setConnectionState: (state) => ipcRenderer.send('connection-state', state),
  sendTrayIcons:      (icons) => ipcRenderer.send('tray-icons', icons),
  openExternal:       (url) => ipcRenderer.send('open-external', url),
  selectStation:      (station, noPlay) => ipcRenderer.send('select-station', station, noPlay),

  // Receive from main
  onSetPlaying:    (cb) => ipcRenderer.on('set-playing',    (_, v) => cb(v)),
  onSetPinned:     (cb) => ipcRenderer.on('set-pinned',     (_, v) => cb(v)),
  onSetMini:       (cb) => ipcRenderer.on('set-mini',       (_, v) => cb(v)),
  onSetMuted:      (cb) => ipcRenderer.on('set-muted',      (_, v) => cb(v)),
  onWindowVisible: (cb) => ipcRenderer.on('window-visible', (_, v) => cb(v)),
  onSleepUpdate:   (cb) => ipcRenderer.on('sleep-update',   (_, v) => cb(v)),
  onAppVersion:    (cb) => ipcRenderer.on('app-version',    (_, v) => cb(v)),
  onResetSettings: (cb) => ipcRenderer.on('reset-settings', () => cb()),
  onSystemIdle:    (cb) => ipcRenderer.on('system-idle',    (_, v) => cb(v)),
  onShowAbout:     (cb) => ipcRenderer.on('show-about',     () => cb()),
  onSetStation:    (cb) => ipcRenderer.on('set-station',    (_, v) => cb(v)),
  onTrackInfo:     (cb) => ipcRenderer.on('track-info',     (_, v) => cb(v)),

  // Queries
  getStations:  () => ipcRenderer.invoke('get-stations'),
  getState:     () => ipcRenderer.invoke('get-state'),
});
