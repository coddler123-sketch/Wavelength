// Shared mutable state for all renderer modules.
// Import this module and mutate state.X directly.
export const audio = document.getElementById('audio');

function loadStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key)) || [];
    return Array.isArray(value) ? value : [];
  } catch (err) {
    void err;
    localStorage.removeItem(key);
    return [];
  }
}

let _favorites = loadStoredArray('wl.favorites');
let _recentStations = loadStoredArray('wl.recentStations');

export const state = {
  // Audio playback
  playing: false,
  muted: false,
  streamUrl: '',
  audioCtx: null,
  analyser: null,
  eqBassFilter: null,
  eqMidFilter: null,
  eqTrebleFilter: null,
  eqBassDb: 0,
  eqMidDb: 0,
  eqTrebleDb: 0,
  stationGain: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  listenTimer: null,
  lastListenAt: 0,

  // App / window
  windowVisible: true,
  sleepEndsAt: 0,
  sleepUiTimer: null,
  themeLevel: 0,
  lastThemeWrite: -1,
  lastThemeAt: 0,
  appVersion: '',
  isInitialized: false,

  // Stations
  allStations: [],
  activeStation: null,
  favorites: _favorites,
  favFilterActive: false,
  recentStations: _recentStations,

  // UI
  currentTrackInfoText: '',
  isListDragging: false,
  listDragStart: 0,
  listScrollStart: 0,
  hasDraggedSignificant: false,
  highlightedIndex: -1,
  stationNameResizeTimer: null,

  // Set by renderer.js after WavelengthVisualizer.create()
  visualizer: null,
};
