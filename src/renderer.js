const api = window.electronAPI;
const audio = document.getElementById('audio');
let streamUrl = '';
let playing = false;
let muted = false;
let windowVisible = true;
let sleepEndsAt = 0;
let sleepUiTimer = null;
let listenTimer = null;
let lastListenAt = 0;
let themeLevel = 0;
let bassFilter = null;
let stationGain = null;
let bassBoostLevel = 0;   // index into BASS_GAINS; loaded from localStorage on init
let appVersion = '';

let isInitialized = false;
let allStations = [];
let activeStation = null;
let currentTrackInfoText = '';
let isListDragging = false;
let listDragStart = 0;
let listScrollStart = 0;
let hasDraggedSignificant = false;

// Favorites & Recents state
let favorites = [];
let favFilterActive = false;
let recentStations = [];
let highlightedIndex = -1;

try {
  favorites = JSON.parse(localStorage.getItem('wl.favorites')) || [];
  if (!Array.isArray(favorites)) favorites = [];
} catch (_) {
  favorites = [];
}

try {
  recentStations = JSON.parse(localStorage.getItem('wl.recentStations')) || [];
  if (!Array.isArray(recentStations)) recentStations = [];
} catch (_) {
  recentStations = [];
}

// ── Persistence (localStorage) ───────────────────
const LS = {
  vol:     'wl.volume',
  pin:     'wl.pin',
  mini:    'wl.mini',
  muted:   'wl.muted',
  playing: 'wl.playing',
  vizMode: 'wl.visualizerMode',
  bass:    'wl.bassBoost',
  listenDate: 'wl.listenDate',
  listenOverallTotal: 'wl.listenOverallTotalMs',
};

function stationTodayKey(id) { return `wl.listenTodayMs_${id}`; }
function stationTotalKey(id) { return `wl.listenTotalMs_${id}`; }
function stationGainKey(id) { return `wl.stationGainDb_${id}`; }

function loadInt(key, fallback) {
  const v = parseInt(localStorage.getItem(key), 10);
  return Number.isFinite(v) ? v : fallback;
}
function loadBool(key) { return localStorage.getItem(key) === '1'; }
saveBool = (key, v) => { localStorage.setItem(key, v ? '1' : '0'); }

// ── Auto-reconnect ───────────────────────────────
let reconnectTimer = null;
let reconnectAttempt = 0;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function setReconnecting(on) {
  document.body.classList.toggle('reconnecting', on);
  if (on) reportConnectionState('reconnecting');
}

function scheduleReconnect() {
  if (reconnectTimer || !playing) return;
  setReconnecting(true);
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
  reconnectAttempt++;
  console.log('[reconnect] in', delay, 'ms (attempt', reconnectAttempt, ')');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (playing) {
      audio.src = streamUrl;
      audio.load();
      audio.play().catch(() => scheduleReconnect());
    }
  }, delay);
}
function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;
  setReconnecting(false);
  if (playing) reportConnectionState(muted ? 'muted' : 'live');
}

// ── Audio + visualizer state ─────────────────────
let audioCtx = null;
let analyser = null;
const BASS_GAINS = [0, 6, 12];                  // lowshelf gain in dB per level
const BASS_LABELS = ['aus', '+6 dB', '+12 dB'];
const STATION_GAIN_MIN_DB = -9;
const STATION_GAIN_MAX_DB = 9;
const STATION_GAIN_STEP_DB = 1;
const { formatListen, averageLevel, fakeBar } = utils;

const visualizer = WavelengthVisualizer.create({
  canvas: document.getElementById('visualizer'),
  miniCanvas: document.getElementById('mini-visualizer'),
  storageKey: LS.vizMode,
  averageLevel,
  getAnalyser: () => analyser,
  getState: () => ({ playing, muted, windowVisible }),
  onLevel: setThemeLevel,
  showToast,
});

let lastThemeWrite = -1;
let lastThemeAt = 0;
function setThemeLevel(level) {
  themeLevel += (Math.max(0, Math.min(1, level)) - themeLevel) * 0.18;
  const now = performance.now();
  if (now - lastThemeAt < 40) return; // 40ms throttle (~25 FPS) for smoother glow
  if (Math.abs(themeLevel - lastThemeWrite) < 0.006) return;
  lastThemeAt = now;
  lastThemeWrite = themeLevel;
  const s = document.body.style;
  s.setProperty('--audio-level', themeLevel.toFixed(3));
  s.setProperty('--audio-glow', (themeLevel * 0.16).toFixed(3));
  s.setProperty('--audio-glow-soft', (themeLevel * 0.09).toFixed(3));
  s.setProperty('--audio-border-glow', (themeLevel * 0.12).toFixed(3));
}

function setLiveStatus(state) {
  const el = document.getElementById('live-status');
  if (!el) return;
  if (state === 'reconnecting') el.textContent = 'Reconnecting';
  else if (state === 'muted') el.textContent = 'Muted';
  else if (state === 'live') el.textContent = 'Live';
  else if (state === 'connecting') el.textContent = 'Connecting';
  else el.textContent = 'Stopped';
}

function reportConnectionState(state) {
  api.setConnectionState(state);
  setLiveStatus(state);
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureListenDate() {
  const today = todayKey();
  if (localStorage.getItem(LS.listenDate) !== today) {
    localStorage.setItem(LS.listenDate, today);
    // Reset today keys for all stations
    for (const station of allStations) {
      localStorage.setItem(stationTodayKey(station.id), '0');
    }
  }
}

function updateListenBadge() {
  ensureListenDate();
  const badge = document.getElementById('listen-badge');
  if (!badge) return;
  if (!activeStation) {
    badge.textContent = `Heute 0 min`;
    badge.title = `Keine Station aktiv`;
    return;
  }
  const today = parseInt(localStorage.getItem(stationTodayKey(activeStation.id)) || '0', 10);
  const total = parseInt(localStorage.getItem(stationTotalKey(activeStation.id)) || '0', 10);
  const overall = parseInt(localStorage.getItem(LS.listenOverallTotal) || '0', 10);

  badge.textContent = `Heute ${formatListen(today)}`;
  badge.title = `Dieser Sender: ${formatListen(total)} gesamt\nWavelength gesamt: ${formatListen(overall)}`;
}

function addListenTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0 || !activeStation) return;
  ensureListenDate();
  const rounded = Math.round(ms);
  
  const today = parseInt(localStorage.getItem(stationTodayKey(activeStation.id)) || '0', 10) + rounded;
  const total = parseInt(localStorage.getItem(stationTotalKey(activeStation.id)) || '0', 10) + rounded;
  const overall = parseInt(localStorage.getItem(LS.listenOverallTotal) || '0', 10) + rounded;

  localStorage.setItem(stationTodayKey(activeStation.id), String(today));
  localStorage.setItem(stationTotalKey(activeStation.id), String(total));
  localStorage.setItem(LS.listenOverallTotal, String(overall));
  
  updateListenBadge();
}

function recordListenTick() {
  const now = Date.now();
  const delta = lastListenAt ? now - lastListenAt : 0;
  lastListenAt = now;
  if (playing && delta >= 1000 && delta <= 90_000) addListenTime(delta);
}

function startListenTimer() {
  if (listenTimer) return;
  lastListenAt = Date.now();
  listenTimer = setInterval(recordListenTick, 15_000);
}

function stopListenTimer() {
  recordListenTick();
  if (listenTimer) { clearInterval(listenTimer); listenTimer = null; }
  lastListenAt = 0;
}

function showToast(message) {
  const toast = document.getElementById('viz-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1100);
}

function updateTimeTheme() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  let dayness = 0;
  if (h >= 8 && h < 18)       dayness = 1;
  else if (h >= 6 && h < 8)   dayness = (h - 6) / 2;
  else if (h >= 18 && h < 21) dayness = (21 - h) / 3;

  const filter = dayness > 0.01
    ? `hue-rotate(${(22 * dayness).toFixed(1)}deg) saturate(${(1 + 0.15 * dayness).toFixed(2)}) brightness(${(1 + 0.06 * dayness).toFixed(2)})`
    : '';
  for (const id of ['visualizer', 'mini-visualizer']) {
    const el = document.getElementById(id);
    if (el) el.style.filter = filter;
  }
}

function initAudioCtx() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;              // 128 frequency bins
  analyser.smoothingTimeConstant = 0.82;
  
  bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.value = 200;
  bassFilter.gain.value = BASS_GAINS[bassBoostLevel];

  stationGain = audioCtx.createGain();
  applyStationGain();
  
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  
  source.connect(bassFilter);
  bassFilter.connect(analyser);
  analyser.connect(stationGain);
  stationGain.connect(limiter);
  limiter.connect(audioCtx.destination);
}

// ── Windows Media Session (SMTC) ─────────────────
function updateMediaSession(isPlaying) {
  if (!('mediaSession' in navigator)) return;
  if (activeStation) {
    let title = currentTrackInfoText || activeStation.name;
    let artist = currentTrackInfoText ? activeStation.name : 'Wavelength Player';
    if (currentTrackInfoText && currentTrackInfoText.includes(' - ')) {
      const parts = currentTrackInfoText.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  title,
      artist: artist,
      album:  `${activeStation.genre} · ${activeStation.country}`,
      artwork: activeStation.iconUrl ? [{ src: activeStation.iconUrl, sizes: '128x128', type: 'image/png' }] : []
    });
  } else {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  'Live Stream',
      artist: 'Wavelength Player',
      album:  'Multi-Station Radio'
    });
  }
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play',  () => api.playPause());
  navigator.mediaSession.setActionHandler('pause', () => api.playPause());
  navigator.mediaSession.setActionHandler('stop',  () => { if (playing) api.playPause(); });
}

// ── Audio Playback ────────────────────────────────
function startPlay() {
  if (!streamUrl) {
    console.warn("Cannot play: streamUrl is empty.");
    return;
  }
  initAudioCtx();
  audio.src = streamUrl;
  audio.load();
  reportConnectionState('connecting');
  audio.play().catch(() => scheduleReconnect());
  playing = true;

  currentTrackInfoText = '';
  displayTrackInfo('');

  saveBool(LS.playing, true);
  updatePlayUI();
  updateMediaSession(true);
  startListenTimer();
  visualizer.start();
}

function stopPlay() {
  playing = false; // Set false first to prevent async error/abort events from triggering scheduleReconnect
  audio.pause();
  audio.src = '';
  try {
    audio.load();
  } catch (e) {}
  cancelReconnect();
  stopListenTimer();
  reportConnectionState('stopped');
  
  currentTrackInfoText = '';
  displayTrackInfo('');

  saveBool(LS.playing, false);
  updatePlayUI();
  updateMediaSession(false);
  visualizer.drawIdle();
}

audio.addEventListener('error', () => {
  if (!playing) return;
  const err = audio.error;
  if (err && err.code === 1) { // MEDIA_ERR_ABORTED
    console.log('[audio] Playback aborted (normal source change), ignoring.');
    return;
  }
  scheduleReconnect();
});
audio.addEventListener('stalled', () => { if (playing) scheduleReconnect(); });
audio.addEventListener('ended',   () => { if (playing) scheduleReconnect(); });
audio.addEventListener('playing', () => {
  cancelReconnect();
  reportConnectionState(muted ? 'muted' : 'live');
});

// ── UI Updates ───────────────────────────────────
function updatePlayUI() {
  document.body.classList.toggle('is-playing', playing);
  const mainPath = document.querySelector('#main-icon path');
  if (mainPath) {
    mainPath.setAttribute('d', playing
      ? 'M 3.5 3.5 L 14.5 3.5 L 14.5 14.5 L 3.5 14.5 Z'
      : 'M 3 2 L 15 9 L 3 16 L 3 2 Z');
  }
  const miniIcon = document.getElementById('mini-icon');
  if (miniIcon) {
    miniIcon.innerHTML = playing
      ? '<rect width="12" height="12" rx="2"/>'
      : '<polygon points="2,1 11,6 2,11"/>';
  }
  // Update ARIA attributes
  const mainBtn = document.getElementById('btn-playstop');
  if (mainBtn) {
    mainBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
    mainBtn.setAttribute('aria-pressed', String(playing));
  }
  const miniBtn = document.getElementById('mini-playstop');
  if (miniBtn) {
    miniBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
    miniBtn.setAttribute('aria-pressed', String(playing));
  }
  updateItemEqualizer();
}
const MUTED_SVG = `
  <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
    <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
    <path d="M10.5 5.5l3 3M13.5 5.5l-3 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>
`;

function speakerSVG(vol) {
  if (vol === 0) {
    return `
      <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
        <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
      </svg>
    `;
  }
  if (vol < 50) {
    return `
      <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
        <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
        <path d="M11 5.5a3 3 0 0 1 0 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      </svg>
    `;
  }
  return `
    <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
      <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
      <path d="M11 5.5a3 3 0 0 1 0 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M13 3.5a6 6 0 0 1 0 8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    </svg>
  `;
}

function updateVolSlider(val, persist = true) {
  audio.volume = val / 100;
  document.getElementById('vol-slider').value = val;
  document.getElementById('vol-val').textContent = val + '%';
  document.getElementById('mini-vol').value = val;
  document.getElementById('mini-vol-val').textContent = val + '%';
  const pct = val + '%';
  const fill = `linear-gradient(to right, var(--accent2) 0%, var(--accent2) ${pct}, var(--surface2) ${pct})`;
  document.getElementById('vol-slider').style.background = fill;
  document.getElementById('mini-vol').style.background = fill;
  if (persist) localStorage.setItem(LS.vol, String(val));
  const isMuteActive = document.body.classList.contains('muted-state');
  document.getElementById('mute-icon').innerHTML = isMuteActive ? MUTED_SVG : speakerSVG(val);
}

function currentStationGainDb() {
  if (!activeStation) return 0;
  return Math.max(STATION_GAIN_MIN_DB, Math.min(STATION_GAIN_MAX_DB, loadInt(stationGainKey(activeStation.id), 0)));
}

function applyStationGain() {
  const db = currentStationGainDb();
  if (stationGain) {
    stationGain.gain.value = Math.pow(10, db / 20);
  }

  const pill = document.getElementById('station-gain-pill');
  const label = db === 0 ? '0 dB' : `${db > 0 ? '+' : ''}${db} dB`;
  if (pill) {
    pill.textContent = label;
    pill.title = `Sender-Trim ${label} · Klick zum Zurücksetzen`;
    pill.classList.toggle('show', db !== 0);
  }
}

function adjustStationGain(deltaDb) {
  if (!activeStation) return;
  const next = Math.max(STATION_GAIN_MIN_DB, Math.min(STATION_GAIN_MAX_DB, currentStationGainDb() + deltaDb));
  if (next === 0) {
    localStorage.removeItem(stationGainKey(activeStation.id));
  } else {
    localStorage.setItem(stationGainKey(activeStation.id), String(next));
  }
  applyStationGain();
  showToast(`Sender ${next > 0 ? '+' : ''}${next} dB`);
}

function resetStationGain() {
  if (!activeStation) return;
  localStorage.removeItem(stationGainKey(activeStation.id));
  applyStationGain();
  showToast('Sender 0 dB');
}

function setMini(on) {
  document.body.classList.toggle('mini-mode', on);
  document.body.classList.toggle('mini-idle', on);
  document.getElementById('btn-toggle-mini').classList.toggle('active', on);
  saveBool(LS.mini, on);
  if (visualizer) {
    visualizer.resize();
  }
  if (!playing) requestAnimationFrame(() => visualizer.drawIdle());
}

function setPinned(on) {
  const btn = document.getElementById('btn-pin');
  btn.classList.toggle('pin-active', on);
  saveBool(LS.pin, on);
}

function setMuted(on) {
  muted = on;
  audio.muted = on;
  document.body.classList.toggle('muted-state', on);
  const vol = parseInt(document.getElementById('vol-slider').value, 10);
  document.getElementById('mute-icon').innerHTML = on ? MUTED_SVG : speakerSVG(vol);
  // Update ARIA attributes
  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    muteBtn.setAttribute('aria-label', on ? 'Stumm aufheben' : 'Stumm');
    muteBtn.setAttribute('aria-pressed', String(on));
  }
  saveBool(LS.muted, on);
  reportConnectionState(playing ? (on ? 'muted' : 'live') : 'stopped');
}

function setAppVersion(version) {
  appVersion = version;
  document.getElementById('about-version').textContent = `v${version}`;
  const logoArea = document.querySelector('.logo-area');
  if (logoArea) logoArea.dataset.version = `v${version}`;
}

function updateSleepBadge() {
  const badge = document.getElementById('sleep-badge');
  if (!badge) return;
  if (!sleepEndsAt) {
    badge.classList.remove('active');
    badge.textContent = '';
    return;
  }

  const minutes = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 60_000));
  if (minutes <= 0) {
    badge.classList.remove('active');
    badge.textContent = '';
    return;
  }
  badge.textContent = `Sleep ${minutes} min`;
  badge.classList.add('active');
}

function setSleepEndsAt(value) {
  const hadTimer = !!sleepEndsAt;
  sleepEndsAt = Number(value) || 0;
  if (sleepUiTimer) {
    clearInterval(sleepUiTimer);
    sleepUiTimer = null;
  }
  updateSleepBadge();
  const sleepBtn = document.getElementById('btn-sleep');
  if (sleepBtn) sleepBtn.classList.toggle('active', !!sleepEndsAt);
  document.body.classList.toggle('sleep-active', !!sleepEndsAt);
  if (sleepEndsAt) sleepUiTimer = setInterval(updateSleepBadge, 30_000);
  if (hadTimer !== !!sleepEndsAt) {
    showToast(sleepEndsAt ? 'Sleep 30 min' : 'Sleep aus');
  }
}

function resetLocalSettings() {
  for (const key of Object.values(LS)) localStorage.removeItem(key);
  localStorage.removeItem('wl.lastStationId');
  // Clear station specific keys
  for (const station of allStations) {
    localStorage.removeItem(stationTodayKey(station.id));
    localStorage.removeItem(stationTotalKey(station.id));
    localStorage.removeItem(stationGainKey(station.id));
  }
  updateVolSlider(80);
  setMuted(false);
  bassBoostLevel = 0;
  applyBassBoost();
  visualizer.resetMode();
  updatePlayUI();
  updateListenBadge();
  if (allStations.length > 0) {
    selectStation(allStations[0]);
  }
}

// ── Bass Boost ───────────────────────────────────
function applyBassBoost() {
  if (bassFilter) bassFilter.gain.value = BASS_GAINS[bassBoostLevel];
  const btn = document.getElementById('btn-bass');
  if (!btn) return;
  btn.classList.toggle('active', bassBoostLevel > 0);
  btn.dataset.level = String(bassBoostLevel);
  btn.title = `Bass Boost: ${BASS_LABELS[bassBoostLevel]}`;
}

function cycleBassBoost() {
  bassBoostLevel = (bassBoostLevel + 1) % BASS_GAINS.length;
  localStorage.setItem(LS.bass, String(bassBoostLevel));
  applyBassBoost();
  showToast(`Bass ${BASS_LABELS[bassBoostLevel]}`);
}

// ── Tray Status Icons ────────────────────────────
function buildTrayIconDataURL(dotColor) {
  const size = 32, s = size / 64, r = 14 * s;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');
  
  // Background
  x.fillStyle = '#0a0915';
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(size, 0, size, size, r);
  x.arcTo(size, size, 0, size, r);
  x.arcTo(0, size, 0, 0, r);
  x.arcTo(0, 0, size, 0, r);
  x.closePath(); x.fill();
  
  // Outer Border Glow
  x.strokeStyle = dotColor;
  x.lineWidth = 1.5 * s;
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(size, 0, size, size, r);
  x.arcTo(size, size, 0, size, r);
  x.arcTo(0, size, 0, 0, r);
  x.arcTo(0, 0, size, 0, r);
  x.closePath(); x.stroke();
  
  // Draw stylized W (sound wave inspired)
  x.strokeStyle = '#f0ece4';
  x.lineWidth = 5 * s; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(12 * s, 16 * s);
  x.lineTo(22 * s, 48 * s);
  x.lineTo(32 * s, 28 * s);
  x.lineTo(42 * s, 48 * s);
  x.lineTo(52 * s, 16 * s);
  x.stroke();
  
  // Glow Dot representing connection status
  x.fillStyle = dotColor;
  x.beginPath(); x.arc(51 * s, 13 * s, 6 * s, 0, Math.PI * 2); x.fill();
  return c.toDataURL('image/png');
}

function sendTrayIcons() {
  const colors = {
    playing: '#00f0ff', reconnecting: '#0072ff', muted: '#7000ff', stopped: '#4a4a4a',
  };
  const icons = {};
  for (const [state, color] of Object.entries(colors)) icons[state] = buildTrayIconDataURL(color);
  api.sendTrayIcons(icons);
}

// ── Station Selection & UI Rendering ─────────────
function getStationCategory(genre) {
  if (!genre) return 'Weltmusik & Sonstige';
  const cleanGenre = genre.toLowerCase().trim();
  
  if (cleanGenre.includes('pop') || cleanGenre.includes('charts') || cleanGenre.includes('hits') || cleanGenre.includes('top40') || cleanGenre.includes('young') || cleanGenre.includes('oldies') || cleanGenre.includes('lokal')) {
    return 'Pop & Charts';
  }
  if (cleanGenre.includes('rock') || cleanGenre.includes('metal') || cleanGenre.includes('grunge') || cleanGenre.includes('punk')) {
    return 'Rock & Metal';
  }
  if (cleanGenre.includes('news') || cleanGenre.includes('talk') || cleanGenre.includes('wissen') || cleanGenre.includes('info') || cleanGenre.includes('politik') || cleanGenre.includes('education') || cleanGenre.includes('podcast')) {
    return 'News, Info & Talk';
  }
  if (cleanGenre.includes('kultur') || cleanGenre.includes('klassik') || cleanGenre.includes('classic') || cleanGenre.includes('jazz') || cleanGenre.includes('blues') || cleanGenre.includes('ambient') || cleanGenre.includes('chill') || cleanGenre.includes('lounge')) {
    return 'Kultur & Klassik';
  }
  if (cleanGenre.includes('electro') || cleanGenre.includes('house') || cleanGenre.includes('dance') || cleanGenre.includes('techno') || cleanGenre.includes('trance') || cleanGenre.includes('lofi') || cleanGenre.includes('beat') || cleanGenre.includes('club')) {
    return 'Electronic & Dance';
  }
  if (cleanGenre.includes('schlager') || cleanGenre.includes('volksmusik') || cleanGenre.includes('heimat')) {
    return 'Schlager & Volksmusik';
  }
  return 'Weltmusik & Sonstige';
}

// ── Station Selection & UI Rendering ─────────────
function renderStations() {
  const listContainer = document.getElementById('station-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const filterText = document.getElementById('station-search').value;
  const selectedGenre = document.getElementById('genre-filter').value;
  const selectedLang = document.getElementById('lang-filter').value;

  const query = filterText.toLowerCase().trim();
  const filtered = allStations.filter(s => {
    // 1. Text filter (name, genre, country, or language)
    const matchesText = !query ||
                        s.name.toLowerCase().includes(query) ||
                        s.genre.toLowerCase().includes(query) ||
                        s.country.toLowerCase().includes(query) ||
                        (s.language && s.language.toLowerCase().includes(query));

    // 2. Category filter
    const matchesGenre = !selectedGenre || getStationCategory(s.genre) === selectedGenre;

    // 3. Language filter
    const matchesLang = !selectedLang || s.language === selectedLang;

    // 4. Favorites filter
    const matchesFav = !favFilterActive || favorites.includes(s.id);

    return matchesText && matchesGenre && matchesLang && matchesFav;
  });

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.fontSize = '11px';
    emptyMsg.style.color = 'var(--text-dim)';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.padding = '20px 10px';
    emptyMsg.textContent = 'Keine Stationen gefunden';
    listContainer.appendChild(emptyMsg);
    return;
  }

  // Reset keyboard highlight when rendering new list
  highlightedIndex = -1;

  const favStations = [];
  const categoryGroups = {
    'Pop & Charts': [],
    'Rock & Metal': [],
    'News, Info & Talk': [],
    'Kultur & Klassik': [],
    'Electronic & Dance': [],
    'Schlager & Volksmusik': [],
    'Weltmusik & Sonstige': []
  };

  // Group stations by favorites or category
  filtered.forEach(station => {
    const isFav = favorites.includes(station.id);
    if (isFav) {
      favStations.push(station);
    } else {
      const cat = getStationCategory(station.genre);
      categoryGroups[cat].push(station);
    }
  });

  // Sort alphabetically
  const compareName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
  favStations.sort(compareName);
  Object.keys(categoryGroups).forEach(cat => {
    categoryGroups[cat].sort(compareName);
  });

  // Helper to create and append group header
  function appendGroupHeader(label, isFav = false) {
    const header = document.createElement('div');
    header.className = 'station-group-header' + (isFav ? ' fav-header' : '');
    if (isFav) {
      header.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="#ffb700" stroke="#ffb700" stroke-width="2" style="margin-right: 4px;">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        ${label}
      `;
    } else {
      header.textContent = label;
    }
    listContainer.appendChild(header);
  }

  // Helper to render a station item
  function renderStationItem(station) {
    const item = document.createElement('button');
    item.className = 'station-item';
    item.type = 'button';
    item.dataset.id = station.id;
    item.setAttribute('aria-label', `${station.name}, ${station.genre}, ${station.country}`);
    if (activeStation && activeStation.id === station.id) {
      item.classList.add('active');
    }

    const imgWrap = document.createElement('div');
    imgWrap.className = 'station-icon-wrap';

    const img = document.createElement('img');
    img.className = 'station-icon';
    img.src = station.iconUrl || '../assets/icon.png';
    img.onerror = () => { img.src = '../assets/icon.png'; };

    const playOverlay = document.createElement('div');
    playOverlay.className = 'station-play-overlay';
    playOverlay.innerHTML = `
      <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
        <polygon points="2,1 9,5 2,9"></polygon>
      </svg>
    `;

    imgWrap.appendChild(img);
    imgWrap.appendChild(playOverlay);

    const details = document.createElement('div');
    details.className = 'station-details';

    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';

    const name = document.createElement('div');
    name.className = 'station-item-name';
    name.textContent = station.name;
    nameRow.appendChild(name);

    // Active playing Equalizer animation
    if (activeStation && activeStation.id === station.id) {
      const eq = document.createElement('div');
      eq.className = 'item-eq-anim';
      eq.style.display = playing ? 'inline-flex' : 'none';
      eq.innerHTML = '<span></span><span></span><span></span>';
      nameRow.appendChild(eq);
    }

    const tags = document.createElement('div');
    tags.className = 'station-tags';

    const genre = document.createElement('span');
    genre.className = 'station-tag';
    genre.textContent = station.genre;

    const country = document.createElement('span');
    country.className = 'station-tag';
    country.textContent = station.country;

    tags.appendChild(genre);
    tags.appendChild(country);
    details.appendChild(nameRow);
    details.appendChild(tags);

    // Favorites Star Button
    const favBtn = document.createElement('button');
    favBtn.className = 'fav-star-btn';
    favBtn.type = 'button';
    const isFav = favorites.includes(station.id);
    if (isFav) favBtn.classList.add('is-fav');
    const favLabel = isFav ? `${station.name} aus Favoriten entfernen` : `${station.name} zu Favoriten hinzufügen`;
    favBtn.setAttribute('aria-label', favLabel);
    favBtn.title = isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
    favBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    `;
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(station.id);
    });
    
    item.appendChild(imgWrap);
    item.appendChild(details);
    item.appendChild(favBtn);

    item.addEventListener('click', () => {
      if (hasDraggedSignificant) return;
      selectStation(station);
    });

    listContainer.appendChild(item);
  }

  // Render Favorites first
  if (favStations.length > 0) {
    appendGroupHeader('Favoriten', true);
    favStations.forEach(renderStationItem);
  }

  // Render each category group
  Object.entries(categoryGroups).forEach(([catName, stations]) => {
    if (stations.length > 0) {
      appendGroupHeader(catName, false);
      stations.forEach(renderStationItem);
    }
  });
}


function populateFilters() {
  const genreFilter = document.getElementById('genre-filter');
  const langFilter = document.getElementById('lang-filter');
  if (!genreFilter || !langFilter) return;

  genreFilter.innerHTML = '<option value="">Alle Kategorien</option>';
  langFilter.innerHTML = '<option value="">Alle Sprachen</option>';

  const categories = [
    'Pop & Charts',
    'Rock & Metal',
    'News, Info & Talk',
    'Kultur & Klassik',
    'Electronic & Dance',
    'Schlager & Volksmusik',
    'Weltmusik & Sonstige'
  ];
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    genreFilter.appendChild(opt);
  });

  const languages = [...new Set(allStations.map(s => s.language).filter(Boolean))].sort();
  languages.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    langFilter.appendChild(opt);
  });
}

function selectStation(station) {
  if (!station) return;
  const wasPlaying = playing;
  activeStation = station;
  streamUrl = station.streamUrl;
  applyStationGain();
  
  // Add to recents
  addRecentStation(station.id);
  
  // Store last selected station
  localStorage.setItem('wl.lastStationId', station.id);

  // Notify main process
  api.selectStation(station);

  // Update active state in UI elements
  document.getElementById('active-station-name').textContent = station.name;
  document.getElementById('active-station-subtitle').textContent = `${station.genre} · ${station.country}`;
  document.getElementById('mini-station-name').textContent = station.name;
  updateMiniLogo(station);
  updatePlayerLogo(station);

  // Re-render list to show active state
  renderStations();
  
  updatePlayerFavStar();
  
  updateListenBadge();

  // If already playing, restart with new stream. If stopped, start playing!
  if (wasPlaying) {
    stopPlay();
    startPlay();
  } else {
    api.playPause(true);
  }

  // Auto switch back to player view after a short delay if in list view
  if (document.body.classList.contains('view-list-active')) {
    setTimeout(() => {
      switchView('player');
    }, 300);
  }
}

// ── Button Wiring ────────────────────────────────
// Helpers for defensive event listener registration
function safeAddListener(id, event, callback) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, callback);
  }
}
function safeQueryListener(selector, event, callback) {
  const el = document.querySelector(selector);
  if (el) {
    el.addEventListener(event, callback);
  }
}

safeAddListener('btn-playstop', 'click', () => api.playPause());
safeAddListener('mini-playstop', 'click', () => api.playPause());
safeAddListener('btn-mute', 'click', () => api.toggleMute());
safeAddListener('vol-slider', 'input', (e) => updateVolSlider(parseInt(e.target.value, 10)));
safeAddListener('mini-vol', 'input', (e) => updateVolSlider(parseInt(e.target.value, 10)));
safeAddListener('btn-pin', 'click', () => api.togglePin());
safeAddListener('btn-toggle-mini', 'click', () => api.toggleMini());
safeAddListener('mini-expand', 'click', () => api.toggleMini());
safeAddListener('btn-hide', 'click', () => api.hideWindow());
safeAddListener('mini-hide', 'click', () => api.hideWindow());
safeAddListener('btn-sleep', 'click', () => api.cycleSleepTimer());
safeAddListener('btn-bass', 'click', cycleBassBoost);
safeAddListener('station-gain-pill', 'click', resetStationGain);
safeAddListener('visualizer', 'click', () => visualizer.toggleMode());

safeAddListener('btn-view-player', 'click', () => switchView('player'));
safeAddListener('btn-view-list', 'click', () => switchView('list'));
safeAddListener('player-fav-btn', 'click', () => {
  if (activeStation) toggleFavorite(activeStation.id);
});

safeAddListener('station-search', 'input', () => renderStations());
safeAddListener('genre-filter', 'change', () => renderStations());
safeAddListener('lang-filter', 'change', () => renderStations());
safeAddListener('btn-fav-filter', 'click', () => {
  favFilterActive = !favFilterActive;
  const btn = document.getElementById('btn-fav-filter');
  if (btn) btn.classList.toggle('active', favFilterActive);
  renderStations();
});

// ── Visualizer Context Menu ───────────────────────
const vizCanvas = document.getElementById('visualizer');
const contextMenu = document.getElementById('viz-context-menu');

if (vizCanvas && contextMenu) {
  vizCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenu.innerHTML = '<div class="context-menu-title">Visualizer Modus</div>';
    
    const currentMode = visualizer.getMode();
    WavelengthVisualizer.VISUALIZER_MODES.forEach(m => {
      const item = document.createElement('div');
      item.className = 'context-menu-item' + (m === currentMode ? ' active' : '');
      item.textContent = WavelengthVisualizer.VISUALIZER_LABELS[m] || m;
      item.addEventListener('click', () => {
        visualizer.setMode(m);
        contextMenu.style.display = 'none';
      });
      contextMenu.appendChild(item);
    });
    
    let x = e.clientX;
    let y = e.clientY;
    
    const menuWidth = 142;
    const menuHeight = 240;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    
    if (x + menuWidth > winWidth) x = winWidth - menuWidth - 8;
    if (y + menuHeight > winHeight) y = winHeight - menuHeight - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';
  });

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.style.display = 'none';
    }
  });
}

// ── Double Click Drag Areas ──────────────────────
safeQueryListener('.logo-area', 'dblclick', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  api.toggleMini();
});
safeQueryListener('.mini-info', 'dblclick', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  api.toggleMini();
});
safeQueryListener('.mini-logo', 'dblclick', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  api.toggleMini();
});

// ── About Modal Control ─────────────────────────
const aboutModal = document.getElementById('about-modal');
let previousFocus = null;

const showAboutModal = () => {
  previousFocus = document.activeElement;
  const ver = document.getElementById('about-version');
  if (ver) ver.textContent = `v${appVersion}`;
  const name = document.getElementById('about-station-name');
  if (name) name.textContent = activeStation ? activeStation.name : 'Keine Station';
  const url = document.getElementById('about-stream-url');
  if (url) url.textContent = streamUrl || '-';
  const web = document.getElementById('about-website-url');
  if (web) web.textContent = activeStation ? activeStation.website : '-';
  if (aboutModal) {
    aboutModal.style.display = 'flex';
    setTimeout(() => {
      const firstFocusable = aboutModal.querySelector('button');
      if (firstFocusable) firstFocusable.focus();
    }, 50);
  }
};
const hideAboutModal = () => {
  if (aboutModal) {
    aboutModal.style.display = 'none';
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
  }
};

safeAddListener('about-close-btn', 'click', hideAboutModal);
safeAddListener('about-ok-btn', 'click', hideAboutModal);
safeAddListener('about-web-btn', 'click', () => {
  if (activeStation && activeStation.website) {
    api.openExternal(activeStation.website);
  }
  hideAboutModal();
});
if (aboutModal) {
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) hideAboutModal();
  });
}

// ── Keyboard shortcuts (in-window) ───────────────
document.addEventListener('keydown', (e) => {
  // Escape closes modal
  if (e.code === 'Escape' && aboutModal && aboutModal.style.display === 'flex') {
    e.preventDefault();
    hideAboutModal();
    return;
  }

  if (e.target.tagName === 'INPUT') return;
  const vol = () => parseInt(document.getElementById('vol-slider').value, 10);
  switch (e.code) {
    case 'Space':      e.preventDefault(); api.playPause(); break;
    case 'KeyM':       api.toggleMute(); break;
    case 'KeyB':       cycleBassBoost(); break;
    case 'KeyV':       visualizer.toggleMode(); break;
    case 'ArrowUp':
      e.preventDefault();
      if (e.altKey) adjustStationGain(STATION_GAIN_STEP_DB);
      else updateVolSlider(Math.min(100, vol() + 5));
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (e.altKey) adjustStationGain(-STATION_GAIN_STEP_DB);
      else updateVolSlider(Math.max(0, vol() - 5));
      break;
  }
});

// ── Mouse wheel → volume & station list scroll ─────
window.addEventListener('wheel', (e) => {
  const picker = e.target.closest('.station-picker');
  if (picker) {
    const list = document.getElementById('station-list');
    if (list) {
      list.scrollTop += e.deltaY;
    }
    return;
  }
  if (e.target.closest('#viz-context-menu') || e.target.closest('.context-menu')) return;
  e.preventDefault();
  const vol = parseInt(document.getElementById('vol-slider').value, 10);
  updateVolSlider(Math.max(0, Math.min(100, vol + (e.deltaY < 0 ? 5 : -5))));
  if (!localStorage.getItem('wl.scrollHintSeen')) {
    localStorage.setItem('wl.scrollHintSeen', '1');
    showToast('Mausrad = Lautstärke');
  }
}, { passive: false });

// ── IPC from main ────────────────────────────────
api.onSetPlaying((val) => { val ? startPlay() : stopPlay(); });
api.onSetPinned(setPinned);
api.onSetMini(setMini);
api.onSetMuted(setMuted);
api.onSleepUpdate(setSleepEndsAt);
api.onAppVersion(setAppVersion);
api.onResetSettings(resetLocalSettings);
api.onSystemIdle((isIdle) => {
  document.body.classList.toggle('system-idle', isIdle);
});
api.onWindowVisible((visible) => {
  windowVisible = visible;
  document.body.classList.toggle('window-hidden', !visible);
  if (visible && playing) visualizer.start();
});
api.onShowAbout(showAboutModal);
api.onSetStation((station) => {
  if (isInitialized && station && (!activeStation || activeStation.id !== station.id)) {
    selectStation(station);
  }
});
api.onTrackInfo((title) => {
  displayTrackInfo(title);
});

// ── Drag to scroll & Track Info Display ──────────
function initListDragToScroll() {
  const list = document.getElementById('station-list');
  if (!list) return;

  list.addEventListener('mousedown', (e) => {
    isListDragging = true;
    hasDraggedSignificant = false;
    listDragStart = e.pageY;
    listScrollStart = list.scrollTop;
  });

  window.addEventListener('mouseup', () => {
    setTimeout(() => {
      isListDragging = false;
    }, 50);
  });

  list.addEventListener('mousemove', (e) => {
    if (!isListDragging) return;
    const delta = e.pageY - listDragStart;
    if (Math.abs(delta) > 5) {
      hasDraggedSignificant = true;
    }
    list.scrollTop = listScrollStart - delta;
  });
}

function displayTrackInfo(title) {
  const container = document.getElementById('track-info-container');
  const textEl = document.getElementById('track-info-text');
  const wrap = document.getElementById('track-info-text-wrap');
  const miniStationName = document.getElementById('mini-station-name');
  if (!textEl || !wrap || !container) return;

  const cleanTitle = title ? title.trim() : '';
  currentTrackInfoText = cleanTitle;

  textEl.classList.remove('marquee-active');
  textEl.style.removeProperty('--marquee-dist');

  if (playing && cleanTitle) {
    textEl.textContent = cleanTitle;
    if (miniStationName) {
      miniStationName.textContent = cleanTitle;
    }
    
    void textEl.offsetWidth;

    const diff = wrap.clientWidth - textEl.scrollWidth;
    if (diff < 0) {
      textEl.style.setProperty('--marquee-dist', `${diff - 16}px`);
      textEl.classList.add('marquee-active');
    }
  } else {
    const defaultText = activeStation ? activeStation.name : 'Wavelength';
    textEl.textContent = defaultText;
    if (miniStationName) {
      miniStationName.textContent = defaultText;
    }
  }
  
  updateMediaSession(playing);
}

function switchView(view) {
  const isList = view === 'list';
  document.body.classList.toggle('view-list-active', isList);

  const btnPlayer = document.getElementById('btn-view-player');
  const btnList = document.getElementById('btn-view-list');
  if (btnPlayer && btnList) {
    btnPlayer.classList.toggle('active', !isList);
    btnList.classList.toggle('active', isList);
    btnPlayer.setAttribute('aria-pressed', String(!isList));
    btnList.setAttribute('aria-pressed', String(isList));
  }

  if (isList) {
    setTimeout(() => {
      const searchInput = document.getElementById('station-search');
      if (searchInput) searchInput.focus();
    }, 50);
  } else {
    if (visualizer) {
      visualizer.resize();
    }
  }
}

function toggleFavorite(id) {
  if (favorites.includes(id)) {
    favorites = favorites.filter(x => x !== id);
  } else {
    favorites.push(id);
  }
  saveFavorites();
  renderStations();
  updatePlayerFavStar();
}

function updatePlayerFavStar() {
  const btn = document.getElementById('player-fav-btn');
  if (!btn) return;
  if (!activeStation) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  const isFav = favorites.includes(activeStation.id);
  btn.classList.toggle('is-fav', isFav);
  btn.title = isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
}

function updateMiniLogo(station) {
  const miniIcon = document.getElementById('mini-station-icon');
  const miniSvg = document.getElementById('mini-logo-svg');
  if (!miniIcon || !miniSvg) return;
  if (station && station.iconUrl) {
    miniIcon.src = station.iconUrl;
    miniIcon.style.display = 'block';
    miniSvg.style.display = 'none';
  } else {
    miniIcon.style.display = 'none';
    miniSvg.style.display = 'block';
  }
}

function updatePlayerLogo(station) {
  const playerIcon = document.getElementById('player-station-icon');
  const defaultLogo = document.getElementById('player-default-logo');
  if (!playerIcon || !defaultLogo) return;
  if (station && station.iconUrl) {
    playerIcon.src = station.iconUrl;
    playerIcon.style.display = 'block';
    defaultLogo.style.display = 'none';
  } else {
    playerIcon.style.display = 'none';
    defaultLogo.style.display = 'block';
  }
}

function saveFavorites() {
  localStorage.setItem('wl.favorites', JSON.stringify(favorites));
}

function saveRecentStations() {
  localStorage.setItem('wl.recentStations', JSON.stringify(recentStations));
}

function addRecentStation(id) {
  recentStations = recentStations.filter(x => x !== id);
  recentStations.unshift(id);
  recentStations = recentStations.slice(0, 5);
  saveRecentStations();
  populateRecents();
}

function populateRecents() {
  const row = document.getElementById('recents-row');
  const list = document.getElementById('recents-list');
  const picker = document.getElementById('station-picker');
  if (!row || !list || !picker) return;

  const activeRecents = recentStations
    .map(id => allStations.find(s => s.id === id))
    .filter(Boolean);

  if (activeRecents.length === 0) {
    row.style.display = 'none';
    picker.classList.remove('has-recents');
    return;
  }

  row.style.display = 'flex';
  picker.classList.add('has-recents');
  list.innerHTML = '';

  activeRecents.forEach(station => {
    const item = document.createElement('button');
    item.className = 'recent-item';
    item.type = 'button';
    item.setAttribute('aria-label', `Zuletzt: ${station.name}`);
    item.title = station.name;

    const img = document.createElement('img');
    img.src = station.iconUrl || '../assets/icon.png';
    img.alt = '';
    img.onerror = () => { img.src = '../assets/icon.png'; };

    item.appendChild(img);
    item.addEventListener('click', () => {
      selectStation(station);
    });

    list.appendChild(item);
  });
}

function updateKeyboardHighlight(index, listItems) {
  listItems.forEach(item => item.classList.remove('highlighted'));
  highlightedIndex = index;
  if (highlightedIndex >= 0 && highlightedIndex < listItems.length) {
    const item = listItems[highlightedIndex];
    item.classList.add('highlighted');
    item.scrollIntoView({ block: 'nearest' });
  }
}

function initKeyboardNav() {
  const searchInput = document.getElementById('station-search');
  if (!searchInput) return;

  searchInput.addEventListener('keydown', (e) => {
    const listContainer = document.getElementById('station-list');
    const items = Array.from(listContainer.querySelectorAll('.station-item'));
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      let nextIndex = highlightedIndex + 1;
      if (nextIndex >= items.length) nextIndex = 0;
      updateKeyboardHighlight(nextIndex, items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      let prevIndex = highlightedIndex - 1;
      if (prevIndex < 0) prevIndex = items.length - 1;
      updateKeyboardHighlight(prevIndex, items);
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < items.length) {
        e.preventDefault();
        const targetId = items[highlightedIndex].dataset.id;
        const station = allStations.find(s => s.id === targetId);
        if (station) {
          selectStation(station);
        }
      }
    }
  });

  searchInput.addEventListener('input', () => {
    highlightedIndex = -1;
  });
}

function updateItemEqualizer() {
  const eqElements = document.querySelectorAll('.item-eq-anim');
  eqElements.forEach(eq => {
    eq.style.display = playing ? 'inline-flex' : 'none';
  });
}

// ── Init ─────────────────────────────────────────
(async () => {
  // Load stations
  allStations = await api.getStations();

  // Populate Genre and Language select filters
  populateFilters();
  
  // Initialize drag-to-scroll on the station list
  initListDragToScroll();

  // Populate recents row on startup
  populateRecents();

  // Initialize keyboard navigation
  initKeyboardNav();
  
  const state = await api.getState();
  const lastStationId = localStorage.getItem('wl.lastStationId');
  let loadedStation = null;
  if (lastStationId) {
    loadedStation = allStations.find(s => s.id === lastStationId);
  }

  activeStation = loadedStation || state.activeStation || allStations[0];
  if (activeStation) {
    streamUrl = activeStation.streamUrl;
    applyStationGain();
    api.selectStation(activeStation, true);

    document.getElementById('active-station-name').textContent = activeStation.name;
    document.getElementById('active-station-subtitle').textContent = `${activeStation.genre} · ${activeStation.country}`;
    document.getElementById('mini-station-name').textContent = activeStation.name;
    updateMiniLogo(activeStation);
    updatePlayerLogo(activeStation);
  }
  
  renderStations();
  updatePlayerFavStar();

  setAppVersion(state.version);
  setSleepEndsAt(state.sleepEndsAt);
  updateListenBadge();

  updateVolSlider(loadInt(LS.vol, 80), false);
  setMuted(loadBool(LS.muted));
  bassBoostLevel = loadInt(LS.bass, 0);
  applyBassBoost();
  updatePlayUI();

  sendTrayIcons();

  visualizer.drawIdle();

  updateTimeTheme();
  setInterval(updateTimeTheme, 60_000);

  if (!localStorage.getItem('wl.vizHintSeen')) {
    localStorage.setItem('wl.vizHintSeen', '1');
    const strip = document.querySelector('.viz-strip');
    if (strip) {
      strip.classList.add('viz-hint');
      strip.addEventListener('animationend', () => strip.classList.remove('viz-hint'), { once: true });
    }
  }

  const wantPin = loadBool(LS.pin);
  if (wantPin !== state.isPinned) api.togglePin();
  const wantMini = loadBool(LS.mini);
  if (wantMini !== state.isMini) api.toggleMini();
  const wantMuted = loadBool(LS.muted);
  if (wantMuted !== state.isMuted) api.toggleMute();

  if (loadBool(LS.playing)) {
    api.playPause();
  }

  // Mini-mode idle opacity fade
  const miniView = document.getElementById('mini-view');
  if (miniView) {
    miniView.addEventListener('mouseenter', () => {
      if (document.body.classList.contains('mini-mode')) {
        document.body.classList.remove('mini-idle');
      }
    });
    miniView.addEventListener('mouseleave', () => {
      if (document.body.classList.contains('mini-mode')) {
        document.body.classList.add('mini-idle');
      }
    });
    if (document.body.classList.contains('mini-mode')) {
      document.body.classList.add('mini-idle');
    }
  }
  isInitialized = true;
})();
