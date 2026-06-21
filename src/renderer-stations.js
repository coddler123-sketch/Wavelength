import { state } from './renderer-state.js';
import {
  setActiveStationName, updateListenBadge, switchView,
  stationGainKey, loadInt, stationTodayKey, applyStationGain,
} from './renderer-ui.js';
import { startPlay, stopPlay } from './renderer-audio.js';

const api = window.electronAPI;
const { getStationCategory, getLanguageLabel, filterStations, buildRecentsList } = window.utils;

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

// ── Station List Rendering ───────────────────────
export function renderStations() {
  const list = document.getElementById('station-list');
  if (!list) return;

  let stations = filterStations(state.allStations, {
    search:         document.getElementById('station-search')?.value || '',
    genre:          document.getElementById('genre-filter')?.value || '',
    lang:           document.getElementById('lang-filter')?.value || '',
    favorites:      state.favorites,
    favFilterActive: state.favFilterActive,
  });

  list.innerHTML = '';
  state.highlightedIndex = -1;

  if (stations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'station-empty';
    empty.textContent = 'Keine Sender gefunden';
    list.appendChild(empty);
    return;
  }

  const categoryGroups = {};
  const favStations = stations.filter(s => state.favorites.includes(s.id));
  const nonFavStations = stations.filter(s => !state.favorites.includes(s.id));

  // Sortiere Favoriten alphabetisch
  favStations.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

  nonFavStations.forEach(s => {
    const cat = getStationCategory(s.genre);
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(s);
  });

  // Sortiere jede Kategoriegruppe alphabetisch
  for (const cat in categoryGroups) {
    categoryGroups[cat].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  }

  function appendGroupHeader(label, isFav = false) {
    const hdr = document.createElement('div');
    hdr.className = 'station-group-header' + (isFav ? ' fav-header' : '');
    hdr.textContent = label;
    list.appendChild(hdr);
  }

  function renderStationItem(station) {
    const item = document.createElement('div');
    item.className = 'station-item';
    item.dataset.id = station.id;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `${station.name}, ${station.genre}, ${station.country}`);
    if (state.activeStation && station.id === state.activeStation.id) {
      item.classList.add('active');
    }
    if (state.favorites.includes(station.id)) {
      item.classList.add('is-fav');
    }

    const today = parseInt(localStorage.getItem(stationTodayKey(station.id)) || '0', 10);
    const gainDb = loadInt(stationGainKey(station.id), 0);
    const iconUrl = safeHttpUrl(station.iconUrl);
    const stationId = escapeHtml(station.id);
    const stationName = escapeHtml(station.name);
    const stationGenre = escapeHtml(station.genre || 'Radio');
    const stationCountry = escapeHtml(station.country || '');

    item.innerHTML = `
      <div class="station-icon-wrap">
        ${iconUrl
          ? `<img class="station-icon" src="${iconUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''
        }
        <svg class="station-icon" ${iconUrl ? 'style="display:none"' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a14 14 0 0 0 0 17M20.5 3.5a14 14 0 0 1 0 17"/>
        </svg>
        <div class="station-play-overlay">
          <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="2,1 9,5 2,9"></polygon>
          </svg>
        </div>
      </div>
      <div class="station-details">
        <span class="station-item-name">${stationName}</span>
        <div class="station-tags">
          <span class="station-tag">${stationGenre}</span>
          ${stationCountry ? `<span class="station-tag">${stationCountry}</span>` : ''}
          ${gainDb !== 0 ? `<span class="station-tag">${gainDb > 0 ? '+' : ''}${gainDb} dB</span>` : ''}
          ${today > 0 ? `<span class="station-tag" style="color: rgba(94, 232, 239, 0.9); font-weight: 600;">${Math.ceil(today / 60000)} Min.</span>` : ''}
        </div>
      </div>
      <div class="item-badges">
        <span class="item-eq-anim" style="display:${state.playing && state.activeStation && station.id === state.activeStation.id ? 'inline-flex' : 'none'}">
          <span></span><span></span><span></span>
        </span>
        <button class="fav-star-btn ${state.favorites.includes(station.id) ? 'is-fav' : ''}"
          aria-label="${state.favorites.includes(station.id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}"
          aria-pressed="${state.favorites.includes(station.id)}"
          data-station-id="${stationId}"
          type="button">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (state.hasDraggedSignificant) return;
      if (e.target.closest('.fav-star-btn')) {
        e.stopPropagation();
        toggleFavorite(station.id);
        return;
      }
      selectStation(station);
    });

    list.appendChild(item);
  }

  if (favStations.length > 0) {
    appendGroupHeader('★ Favoriten', true);
    favStations.forEach(renderStationItem);
  }

  const sortedCategories = Object.keys(categoryGroups).sort();
  for (const cat of sortedCategories) {
    appendGroupHeader(cat);
    categoryGroups[cat].forEach(renderStationItem);
  }
}

// ── Station Selection ────────────────────────────
export function selectStation(station, options = {}) {
  if (!station) return;
  const { syncMain = true, startWhenStopped = true } = options;
  const wasPlaying = state.playing;
  state.activeStation = station;
  state.streamUrl = station.streamUrl;
  applyStationGain();

  addRecentStation(station.id);

  localStorage.setItem('wl.lastStationId', station.id);

  if (syncMain) api.selectStation(station, !startWhenStopped && !wasPlaying);

  setActiveStationName(station.name);
  document.getElementById('active-station-subtitle').textContent =
    `${station.genre} · ${station.country}`;
  document.getElementById('mini-station-name').textContent = station.name;
  document.getElementById('mini-station-name').title = station.name;
  updateMiniLogo(station);
  updatePlayerLogo(station);

  renderStations();
  updatePlayerFavStar();
  updateListenBadge();

  if (wasPlaying) {
    stopPlay();
    startPlay();
  }
}

// ── Filters ──────────────────────────────────────
export function populateFilters() {
  const genreSelect = document.getElementById('genre-filter');
  const langSelect  = document.getElementById('lang-filter');
  if (!genreSelect || !langSelect) return;

  const categories = [
    'Ambient/Chillout',
    'Pop & Charts',
    'Rock & Metal',
    'Elektronik & Dance',
    'Hip-Hop & R&B',
    'Klassik & Jazz',
    'Wissen & Kultur',
    'Nachrichten & Talk',
    'Oldies & Jahrzehnte',
    'Schlager & Weltmusik',
    'Sonstige'
  ];
  const langs  = [...new Set(state.allStations.map(s => getLanguageLabel(s.language)).filter(Boolean))].sort();

  genreSelect.replaceChildren();
  langSelect.replaceChildren();
  appendOption(genreSelect, '', 'Alle Kategorien');
  appendOption(langSelect, '', 'Alle Sprachen');
  categories.forEach(c => appendOption(genreSelect, c, c));
  langs.forEach(l => appendOption(langSelect, l, l));
}

// ── Favorites ────────────────────────────────────
function saveFavorites() {
  localStorage.setItem('wl.favorites', JSON.stringify(state.favorites));
}

export function toggleFavorite(id) {
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter(x => x !== id);
  } else {
    state.favorites.push(id);
  }
  saveFavorites();
  renderStations();
  updatePlayerFavStar();
}

export function updatePlayerFavStar() {
  const btn = document.getElementById('player-fav-btn');
  if (!btn) return;
  if (!state.activeStation) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  const isFav = state.favorites.includes(state.activeStation.id);
  btn.classList.toggle('is-fav', isFav);
  const label = isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(isFav));
}

// ── Logos ────────────────────────────────────────
export function updateMiniLogo(station) {
  const miniIcon = document.getElementById('mini-station-icon');
  const miniSvg  = document.getElementById('mini-logo-svg');
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

export function updatePlayerLogo(station) {
  const playerIcon  = document.getElementById('player-station-icon');
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

// ── Recents ──────────────────────────────────────
function saveRecentStations() {
  localStorage.setItem('wl.recentStations', JSON.stringify(state.recentStations));
}

function addRecentStation(id) {
  state.recentStations = buildRecentsList(state.recentStations, id);
  saveRecentStations();
  populateRecents();
}

export function populateRecents() {
  const row    = document.getElementById('recents-row');
  const list   = document.getElementById('recents-list');
  const picker = document.getElementById('station-picker');
  if (!row || !list || !picker) return;

  const activeRecents = state.recentStations
    .map(id => state.allStations.find(s => s.id === id))
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
    item.addEventListener('click', () => selectStation(station));
    list.appendChild(item);
  });
}

// ── Keyboard Navigation ──────────────────────────
function updateKeyboardHighlight(index, listItems) {
  listItems.forEach(item => item.classList.remove('highlighted'));
  state.highlightedIndex = index;
  if (index >= 0 && index < listItems.length) {
    const item = listItems[index];
    item.classList.add('highlighted');
    item.scrollIntoView({ block: 'nearest' });
  }
}

export function initKeyboardNav() {
  const searchInput = document.getElementById('station-search');
  if (!searchInput) return;

  searchInput.addEventListener('keydown', (e) => {
    const listContainer = document.getElementById('station-list');
    const items = Array.from(listContainer.querySelectorAll('.station-item'));
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      let nextIndex = state.highlightedIndex + 1;
      if (nextIndex >= items.length) nextIndex = 0;
      updateKeyboardHighlight(nextIndex, items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      let prevIndex = state.highlightedIndex - 1;
      if (prevIndex < 0) prevIndex = items.length - 1;
      updateKeyboardHighlight(prevIndex, items);
    } else if (e.key === 'Enter') {
      if (state.highlightedIndex >= 0 && state.highlightedIndex < items.length) {
        e.preventDefault();
        const targetId = items[state.highlightedIndex].dataset.id;
        const station = state.allStations.find(s => s.id === targetId);
        if (station) selectStation(station);
      }
    }
  });

  searchInput.addEventListener('input', () => { state.highlightedIndex = -1; });
}
