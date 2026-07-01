import { state } from './renderer-state.js';
import {
  setActiveStationName, updateListenBadge, switchView,
  stationGainKey, loadInt, stationTodayKey, applyStationGain,
  showToast, applyMarquee,
} from './renderer-ui.js';
import { startPlay, stopPlay } from './renderer-audio.js';
import { escapeHtml, safeHttpUrl } from './renderer-sanitize.mjs';
import { shouldSuppressMainAutoplay, shouldRestartPlayback } from './station-selection.mjs';
import { t, displayGenre } from './i18n.js';

const api = window.electronAPI;
const { getStationCategory, getLanguageLabel, filterStations, buildRecentsList } = window.utils;

const iconRendererCache = new Map(); // url -> dataUrl (renderer-side, survives re-renders)

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

// ── Loading Skeleton ─────────────────────────────
export function showStationsLoading() {
  const list = document.getElementById('station-list');
  if (!list) return;
  list.classList.add('is-loading');
  const rows = Array.from({ length: 8 }, () => `
    <div class="station-skeleton" aria-hidden="true">
      <div class="skeleton-icon"></div>
      <div class="skeleton-text">
        <div class="skeleton-line skeleton-line-name"></div>
        <div class="skeleton-line skeleton-line-meta"></div>
      </div>
    </div>
  `).join('');
  list.innerHTML = rows;
}

// ── Station List Rendering ───────────────────────
export function renderStations() {
  const list = document.getElementById('station-list');
  if (!list) return;

  let stations = filterStations(state.allStations, {
    search:         document.getElementById('station-search')?.value || '',
    genre:          document.getElementById('genre-filter')?.value || '',
    lang:           document.getElementById('lang-filter')?.value || '',
    minBitrate:     parseInt(document.getElementById('bitrate-filter')?.value || '0', 10),
    favorites:      state.favorites,
    favFilterActive: state.favFilterActive,
  });

  list.innerHTML = '';
  list.classList.remove('is-loading');
  state.highlightedIndex = -1;

  if (stations.length === 0) {
    const search = document.getElementById('station-search')?.value?.trim() || '';
    const genre = document.getElementById('genre-filter')?.value || '';
    const lang = document.getElementById('lang-filter')?.value || '';
    const bitrate = parseInt(document.getElementById('bitrate-filter')?.value || '0', 10);
    const hasFilters = !!(search || genre || lang || bitrate);

    let icon, title, hint;
    if (state.favFilterActive) {
      icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>';
      title = t('empty.fav.title');
      hint = t('empty.fav.hint');
    } else if (hasFilters) {
      icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      title = t('empty.search.title');
      hint = search ? t('empty.search.hint.query', escapeHtml(search)) : t('empty.search.hint.filter');
    } else {
      icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/></svg>';
      title = t('empty.none.title');
      hint = t('empty.none.hint');
    }

    const empty = document.createElement('div');
    empty.className = 'station-empty';
    empty.innerHTML = `
      <div class="station-empty-icon">${icon}</div>
      <div class="station-empty-title">${title}</div>
      <div class="station-empty-hint">${hint}</div>
    `;
    list.appendChild(empty);
    return;
  }

  const categoryGroups = {};
  const customStns = stations.filter(s => s.isCustom);
  const favStations = stations.filter(s => !s.isCustom && state.favorites.includes(s.id));
  const nonFavStations = stations.filter(s => !s.isCustom && !state.favorites.includes(s.id));

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
    const genreDisplay = displayGenre(station.genre);
    item.setAttribute('aria-label', `${station.name}, ${genreDisplay}, ${station.country}`);
    const tipParts = [station.name];
    if (genreDisplay) tipParts.push(genreDisplay);
    if (station.country) tipParts.push(station.country);
    if (station.bitrate) tipParts.push(`${station.bitrate} kbps`);
    if (station.codec) tipParts.push(station.codec);
    item.title = tipParts.join(' · ');
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
    const stationGenre = escapeHtml(displayGenre(station.genre) || 'Radio');
    const stationCountry = escapeHtml(station.country || '');

    item.innerHTML = `
      <div class="station-icon-wrap">
        <img class="station-icon hidden" alt="">
        <svg class="station-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
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
          ${today > 0 ? `<span class="station-tag station-tag--today">${t('listen.min', Math.ceil(today / 60000))}</span>` : ''}
        </div>
      </div>
      <div class="item-badges">
        <span class="item-eq-anim${state.playing && state.activeStation && station.id === state.activeStation.id ? '' : ' hidden'}">
          <span></span><span></span><span></span>
        </span>
        <button class="fav-star-btn ${state.favorites.includes(station.id) ? 'is-fav' : ''}" aria-label="${state.favorites.includes(station.id) ? t('fav.remove') : t('fav.add')}" aria-pressed="${state.favorites.includes(station.id)}" data-station-id="${stationId}" type="button"><svg width="10" height="10" viewBox="-2 -2.5 28 28" overflow="visible" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button>
      </div>
    `;

    if (station.isCustom) {
      const badges = item.querySelector('.item-badges');
      if (badges) {
        const editBtn = document.createElement('button');
        editBtn.className = 'station-edit-btn';
        editBtn.title = t('tooltip.edit');
        editBtn.setAttribute('aria-label', t('tooltip.station.edit'));
        editBtn.type = 'button';
        editBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        const delBtn = document.createElement('button');
        delBtn.className = 'station-delete-btn';
        delBtn.title = t('tooltip.delete');
        delBtn.setAttribute('aria-label', t('tooltip.station.delete'));
        delBtn.type = 'button';
        delBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
        badges.insertBefore(delBtn, badges.firstChild);
        badges.insertBefore(editBtn, badges.firstChild);
      }
    }

    item.addEventListener('click', (e) => {
      if (state.hasDraggedSignificant) return;
      if (e.target.closest('.station-edit-btn')) {
        e.stopPropagation();
        openStationEditor(station);
        return;
      }
      if (e.target.closest('.station-delete-btn')) {
        e.stopPropagation();
        deleteCustomStation(station);
        return;
      }
      if (e.target.closest('.fav-star-btn')) {
        e.stopPropagation();
        toggleFavorite(station.id);
        return;
      }
      selectStation(station);
      switchView('player');
    });

    list.appendChild(item);

    if (iconUrl) {
      const imgEl = item.querySelector('img.station-icon');
      const svgEl = item.querySelector('svg.station-icon');
      if (iconRendererCache.has(iconUrl)) {
        imgEl.src = iconRendererCache.get(iconUrl);
        imgEl.classList.remove('hidden');
        svgEl.classList.add('hidden');
      } else {
        api.cacheIcon(iconUrl).then(dataUrl => {
          if (dataUrl && imgEl && svgEl) {
            iconRendererCache.set(iconUrl, dataUrl);
            imgEl.src = dataUrl;
            imgEl.classList.remove('hidden');
            svgEl.classList.add('hidden');
          }
        }).catch(() => {});
      }
    }
  }

  if (customStns.length > 0) {
    appendGroupHeader(t('group.custom'));
    customStns.forEach(renderStationItem);
  }
  if (favStations.length > 0) {
    appendGroupHeader(t('group.favorites'), true);
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

  if (syncMain) {
    api.selectStation(station, shouldSuppressMainAutoplay(startWhenStopped, wasPlaying));
    if (station.streamUrl) {
      api.checkStream(station.streamUrl).then(result => {
        if (!result.ok) {
          showToast(t('toast.stream.error', result.error || result.statusCode), {
            actionLabel: t('toast.retry'),
            onAction: () => selectStation(station, { startWhenStopped: true }),
          });
        }
      }).catch(() => {});
    }
  }

  setActiveStationName(station.name);
  const gainDb = loadInt(stationGainKey(station.id), 0);
  const gainStr = gainDb !== 0 ? ` · ${gainDb > 0 ? '+' : ''}${gainDb} dB` : '';
  document.getElementById('active-station-subtitle').textContent =
    `${displayGenre(station.genre)} · ${station.country}${gainStr}`;
  const miniStationName = document.getElementById('mini-station-name');
  miniStationName.title = station.name;
  applyMarquee(miniStationName, station.name);
  const miniLogoWrap = document.getElementById('mini-logo-wrap');
  if (miniLogoWrap) miniLogoWrap.title = station.name;
  const miniSub = document.getElementById('mini-station-subtitle');
  if (miniSub) miniSub.textContent = [displayGenre(station.genre), station.country].filter(Boolean).join(' · ');
  updateMiniLogo(station);
  updatePlayerLogo(station);

  renderStations();
  updatePlayerFavStar();
  updateListenBadge();

  if (shouldRestartPlayback(wasPlaying)) {
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
    ['Ambient/Chillout',    'filter.cat.ambient'],
    ['Pop & Charts',        'filter.cat.pop'],
    ['Rock & Metal',        'filter.cat.rock'],
    ['Elektronik & Dance',  'filter.cat.electronic'],
    ['Hip-Hop & R&B',       'filter.cat.hiphop'],
    ['Klassik & Jazz',      'filter.cat.classical'],
    ['Wissen & Kultur',     'filter.cat.knowledge'],
    ['Nachrichten & Talk',  'filter.cat.news'],
    ['Oldies & Jahrzehnte', 'filter.cat.oldies'],
    ['Schlager & Weltmusik','filter.cat.schlager'],
    ['Sonstige',            'filter.cat.other'],
  ];
  const langs  = [...new Set(state.allStations.map(s => getLanguageLabel(s.language)).filter(Boolean))].sort();

  genreSelect.replaceChildren();
  langSelect.replaceChildren();
  appendOption(genreSelect, '', t('filter.all.categories'));
  appendOption(langSelect, '', t('filter.all.languages'));
  categories.forEach(([val, key]) => appendOption(genreSelect, val, t(key)));
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
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  const isFav = state.favorites.includes(state.activeStation.id);
  btn.classList.toggle('is-fav', isFav);
  const label = isFav ? t('fav.remove') : t('fav.add');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(isFav));
}

// ── Logos ────────────────────────────────────────
export function updateMiniLogo(station) {
  const miniIcon = document.getElementById('mini-station-icon');
  const miniSvg  = document.getElementById('mini-logo-svg');
  if (!miniIcon || !miniSvg) return;
  const url = station && safeHttpUrl(station.iconUrl);
  if (url) {
    if (iconRendererCache.has(url)) {
      miniIcon.src = iconRendererCache.get(url);
      miniIcon.classList.remove('hidden');
      miniSvg.classList.add('hidden');
    } else {
      api.cacheIcon(url).then(dataUrl => {
        if (dataUrl) {
          iconRendererCache.set(url, dataUrl);
          miniIcon.src = dataUrl;
          miniIcon.classList.remove('hidden');
          miniSvg.classList.add('hidden');
        }
      }).catch(() => {});
    }
  } else {
    miniIcon.classList.add('hidden');
    miniSvg.classList.remove('hidden');
  }
}

export function updatePlayerLogo(station) {
  const playerIcon  = document.getElementById('player-station-icon');
  const defaultLogo = document.getElementById('player-default-logo');
  if (!playerIcon || !defaultLogo) return;
  const url = station && safeHttpUrl(station.iconUrl);
  if (url) {
    const handleUrl = (srcUrl) => {
      updateDynamicThemeFromIcon(srcUrl);
    };
    if (iconRendererCache.has(url)) {
      playerIcon.src = iconRendererCache.get(url);
      playerIcon.classList.remove('hidden');
      defaultLogo.classList.add('hidden');
      handleUrl(playerIcon.src);
    } else {
      api.cacheIcon(url).then(dataUrl => {
        if (dataUrl) {
          iconRendererCache.set(url, dataUrl);
          playerIcon.src = dataUrl;
          playerIcon.classList.remove('hidden');
          defaultLogo.classList.add('hidden');
          handleUrl(dataUrl);
        } else {
          resetDynamicTheme();
        }
      }).catch(() => {
        resetDynamicTheme();
      });
    }
  } else {
    playerIcon.classList.add('hidden');
    defaultLogo.classList.remove('hidden');
    resetDynamicTheme();
  }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function updateDynamicThemeFromIcon(iconUrl) {
  if (!iconUrl) {
    resetDynamicTheme();
    return;
  }
  const img = new Image();
  img.crossOrigin = 'Anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;

      let bestR = 0, bestG = 240, bestB = 255;
      let maxSat = -1;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 180) continue; // skip transparent

        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        const diff = maxVal - minVal;
        if (maxVal > 40 && diff > maxSat) {
          maxSat = diff;
          bestR = r;
          bestG = g;
          bestB = b;
        }
      }

      if (maxSat < 20) {
        resetDynamicTheme();
        return;
      }

      const [h, s, l] = rgbToHsl(bestR, bestG, bestB);
      const neonS = Math.max(0.85, s);
      const neonL1 = 0.52;
      const neonL2 = 0.48;

      const c1 = hslToRgb(h, neonS, neonL1);
      const c2 = hslToRgb((h + 0.33) % 1.0, neonS, neonL2);
      const c3 = hslToRgb((h + 0.67) % 1.0, neonS, neonL1);

      const r = document.documentElement;
      const hex = (rgb) => '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');
      const color1 = hex(c1);
      const color2 = hex(c2);
      const color3 = hex(c3);

      r.style.setProperty('--accent', color1);
      r.style.setProperty('--accent2', color2);
      r.style.setProperty('--accent3', color3);

      if (state.visualizer && typeof state.visualizer.setColors === 'function') {
        state.visualizer.setColors(c1, c2, c3);
      }
    } catch (e) {
      console.warn('Failed to extract colors from icon:', e);
      resetDynamicTheme();
    }
  };
  img.onerror = () => {
    resetDynamicTheme();
  };
  img.src = iconUrl;
}

function resetDynamicTheme() {
  const r = document.documentElement;
  r.style.removeProperty('--accent');
  r.style.removeProperty('--accent2');
  r.style.removeProperty('--accent3');
  
  if (state.visualizer && typeof state.visualizer.setColors === 'function') {
    state.visualizer.setColors(null, null, null);
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
    row.classList.add('hidden');
    picker.classList.remove('has-recents');
    return;
  }

  row.classList.remove('hidden');
  picker.classList.add('has-recents');
  list.innerHTML = '';

  activeRecents.forEach(station => {
    const item = document.createElement('button');
    item.className = 'recent-item';
    item.type = 'button';
    item.setAttribute('aria-label', t('tooltip.recent', station.name));
    item.title = station.name;

    const img = document.createElement('img');
    img.src = '../assets/icon.png';
    img.alt = '';
    const recentUrl = safeHttpUrl(station.iconUrl);
    if (recentUrl) {
      api.cacheIcon(recentUrl).then(dataUrl => { if (dataUrl) img.src = dataUrl; }).catch(() => {});
    }
    item.appendChild(img);
    item.addEventListener('click', () => { selectStation(station); switchView('player'); });
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
        if (station) { selectStation(station); switchView('player'); }
      }
    }
  });

  searchInput.addEventListener('input', () => { state.highlightedIndex = -1; });
}

// ── Custom Station Editor ────────────────────────
let _editorPrevFocus = null;

export function openStationEditor(station = null) {
  _editorPrevFocus = document.activeElement;
  const modal    = document.getElementById('station-editor-modal');
  const title    = document.getElementById('station-editor-title');
  const idInput  = document.getElementById('station-editor-id');
  const nameEl   = document.getElementById('station-editor-name');
  const urlEl    = document.getElementById('station-editor-url');
  const genreEl  = document.getElementById('station-editor-genre');
  const iconEl   = document.getElementById('station-editor-icon');
  const errorEl  = document.getElementById('station-editor-error');
  if (!modal) return;
  title.textContent   = station ? t('editor.title.edit') : t('editor.title.add');
  idInput.value       = station ? station.id : '';
  nameEl.value        = station ? station.name : '';
  urlEl.value         = station ? station.streamUrl : '';
  genreEl.value       = station && station.genre !== 'Eigene' ? station.genre : '';
  iconEl.value        = station ? (station.iconUrl || '') : '';
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  nameEl.focus();
}

export function closeStationEditor() {
  const modal = document.getElementById('station-editor-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (_editorPrevFocus?.focus) { _editorPrevFocus.focus(); _editorPrevFocus = null; }
}

function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const bodyEl = document.getElementById('confirm-modal-body');
  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  if (!modal || !titleEl || !bodyEl || !okBtn || !cancelBtn) return;

  titleEl.textContent = title;
  bodyEl.textContent = message;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const prevFocus = document.activeElement;
  cancelBtn.focus();

  const cleanup = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeyDown);
    if (prevFocus?.focus) prevFocus.focus();
  };

  const handleOk = () => {
    cleanup();
    onConfirm();
  };

  const handleCancel = () => {
    cleanup();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeyDown);
}

function deleteCustomStation(station) {
  showConfirmModal(
    'Station löschen?',
    `Möchtest du die Station „${station.name}“ wirklich löschen?`,
    async () => {
      try {
        const newStations = await api.removeCustomStation(station.id);
        state.allStations = newStations;
        populateFilters();
        renderStations();
      } catch (err) {
        console.error('[custom-station] delete failed:', err);
      }
    }
  );
}

export function initStationEditor() {
  const form      = document.getElementById('station-editor-form');
  const modal     = document.getElementById('station-editor-modal');
  const errorEl   = document.getElementById('station-editor-error');
  if (!form) return;

  document.getElementById('station-editor-close-btn')?.addEventListener('click', closeStationEditor);
  document.getElementById('station-editor-cancel-btn')?.addEventListener('click', closeStationEditor);
  modal?.addEventListener('click', e => { if (e.target === modal) closeStationEditor(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const id       = document.getElementById('station-editor-id').value;
    const name     = document.getElementById('station-editor-name').value.trim();
    const streamUrl = document.getElementById('station-editor-url').value.trim();
    const genre    = document.getElementById('station-editor-genre').value.trim();
    const iconUrl  = document.getElementById('station-editor-icon').value.trim();

    const showErr = msg => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    };
    if (!name)       { showErr(t('editor.err.name')); document.getElementById('station-editor-name').focus(); return; }
    if (!streamUrl)  { showErr(t('editor.err.url')); document.getElementById('station-editor-url').focus(); return; }
    if (!/^https?:\/\//i.test(streamUrl)) { showErr(t('editor.err.url')); document.getElementById('station-editor-url').focus(); return; }

    const saveBtn = document.getElementById('station-editor-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = t('editor.saving');
    try {
      const data = { name, streamUrl, genre, iconUrl };
      const newStations = id
        ? await api.updateCustomStation(id, data)
        : await api.addCustomStation(data);
      state.allStations = newStations;
      populateFilters();
      renderStations();
      closeStationEditor();
    } catch (err) {
      showErr(t('editor.err.save'));
      console.error('[custom-station] save failed:', err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = t('editor.save');
    }
  });
}
