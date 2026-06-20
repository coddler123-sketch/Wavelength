// Shared mutable state for all renderer modules.
// Import this module and mutate state.X directly.
export const audio = document.getElementById('audio');

let _favorites = [];
let _recentStations = [];
try {
  _favorites = JSON.parse(localStorage.getItem('wl.favorites')) || [];
  if (!Array.isArray(_favorites)) _favorites = [];
} catch (_) {}
try {
  _recentStations = JSON.parse(localStorage.getItem('wl.recentStations')) || [];
  if (!Array.isArray(_recentStations)) _recentStations = [];
} catch (_) {}

export const state = {
  // Audio playback
  playing: false,
  muted: false,
  streamUrl: '',
  audioCtx: null,
  analyser: null,
  bassFilter: null,
  stationGain: null,
  bassBoostLevel: 0,
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
