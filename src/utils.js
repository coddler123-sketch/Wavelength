// Runs in both Node (require) and browser (sets window.utils).
(function (exports) {
  function formatListen(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  function averageLevel(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  // Pure tray-state resolver — same logic as main.js trayState(), but testable.
  function trayState(connectionState, isMuted, isPlaying) {
    if (connectionState === 'reconnecting') return 'reconnecting';
    if (isMuted) return 'muted';
    return isPlaying ? 'playing' : 'stopped';
  }

  // Smooth multi-sine fake bar for the visualizer fallback animation.
  function fakeBar(t, i, count) {
    const shape = Math.pow(Math.sin((i / count) * Math.PI), 0.6);
    const n =
      Math.sin(t * 1.1 + i * 0.35) * 0.3 +
      Math.sin(t * 2.3 + i * 0.19) * 0.22 +
      Math.sin(t * 0.7 + i * 0.52) * 0.18 +
      Math.sin(t * 3.7 + i * 0.11) * 0.14 +
      Math.sin(t * 0.31 + i * 0.73) * 0.08 +
      Math.sin(t * 5.1 + i * 0.27) * 0.05;
    return Math.max(0, Math.min(1, (n + 0.62) * shape));
  }

  function getStationCategory(genre) {
    if (!genre) return 'Sonstige';
    const g = genre.toLowerCase();
    if (
      g.includes('wissen') ||
      g.includes('knowledge') ||
      g.includes('science') ||
      g.includes('kultur') ||
      g.includes('culture')
    )
      return 'Wissen & Kultur';
    if (
      g.includes('hiphop') ||
      g.includes('hip hop') ||
      g.includes('hip-hop') ||
      g.includes('rap') ||
      g.includes('urban') ||
      g.includes('r&b') ||
      g.includes('soul') ||
      g.includes('funk') ||
      g.includes('reggae') ||
      g.includes('ska') ||
      g.includes('dancehall')
    )
      return 'Hip-Hop & R&B';
    if (
      g.includes('ambient') ||
      g.includes('chill') ||
      g.includes('lounge') ||
      g.includes('lofi') ||
      g.includes('downtempo') ||
      g.includes('relax') ||
      g.includes('easy listening') ||
      g.includes('leichte musik') ||
      g.includes('instrumental')
    )
      return 'Ambient/Chillout';
    if (
      /\b(50s|60s|70s|80s|90s|00s|10s|1950s|1960s|1970s|1980s|1990s|2000s|2010s)\b/.test(g) ||
      /\b(50er|60er|70er|80er|90er|00er|2000er|2010er)\b/.test(g) ||
      g.includes('oldies') ||
      g.includes('retro')
    )
      return 'Oldies & Jahrzehnte';
    if (g.includes('pop') || g.includes('top 40') || g.includes('hits')) return 'Pop & Charts';
    if (g.includes('rock') || g.includes('metal') || g.includes('alternative') || g.includes('indie'))
      return 'Rock & Metal';
    if (
      g.includes('electro') ||
      g.includes('electronic') ||
      g.includes('elektronik') ||
      g.includes('edm') ||
      g.includes('techno') ||
      g.includes('trance') ||
      g.includes('house') ||
      g.includes('dance') ||
      g.includes('dnb') ||
      g.includes('drum')
    )
      return 'Elektronik & Dance';
    if (
      g.includes('classic') ||
      g.includes('classical') ||
      g.includes('klassik') ||
      g.includes('orchestral') ||
      g.includes('symphony') ||
      g.includes('opera') ||
      g.includes('chamber') ||
      g.includes('jazz') ||
      g.includes('blues') ||
      g.includes('swing')
    )
      return 'Klassik & Jazz';
    if (
      g.includes('news') ||
      g.includes('talk') ||
      g.includes('speech') ||
      g.includes('info') ||
      g.includes('information') ||
      g.includes('public radio') ||
      g.includes('nachrichten')
    )
      return 'Nachrichten & Talk';
    if (
      g.includes('schlager') ||
      g.includes('country') ||
      g.includes('weltmusik') ||
      g.includes('world') ||
      g.includes('global') ||
      g.includes('multicultural')
    )
      return 'Schlager & Weltmusik';
    if (g.includes('variety') || g.includes('mix')) return 'Pop & Charts';
    return 'Sonstige';
  }

  function getLanguageLabel(language) {
    const raw = String(language || '').trim();
    const normalized = raw.toLowerCase();
    const labels = {
      german: 'Deutsch',
      deutsch: 'Deutsch',
      de: 'Deutsch',
      english: 'Englisch',
      englisch: 'Englisch',
      en: 'Englisch',
      french: 'Französisch',
      francais: 'Französisch',
      français: 'Französisch',
      fr: 'Französisch',
      spanish: 'Spanisch',
      espanol: 'Spanisch',
      español: 'Spanisch',
      es: 'Spanisch',
      italian: 'Italienisch',
      it: 'Italienisch',
      dutch: 'Niederländisch',
      nl: 'Niederländisch',
      instrumental: 'Instrumental',
    };
    return labels[normalized] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '');
  }

  function filterStations(
    stations,
    { search = '', genre = '', lang = '', minBitrate = 0, favorites = [], favFilterActive = false } = {}
  ) {
    const q = search.toLowerCase().trim();
    return stations.filter((s) => {
      if (favFilterActive && !favorites.includes(s.id)) return false;
      if (genre && getStationCategory(s.genre) !== genre) return false;
      if (lang && getLanguageLabel(s.language) !== getLanguageLabel(lang)) return false;
      if (minBitrate > 0 && !s.isCustom && (s.bitrate || 0) < minBitrate) return false;
      if (q) {
        return (
          s.name.toLowerCase().includes(q) ||
          (s.genre || '').toLowerCase().includes(q) ||
          (s.country || '').toLowerCase().includes(q) ||
          (s.language || '').toLowerCase().includes(q) ||
          getLanguageLabel(s.language).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  function buildRecentsList(ids, newId, max = 5) {
    return [newId, ...ids.filter((x) => x !== newId)].slice(0, max);
  }

  function buildStatsList(stations, listenData) {
    const nameMap = new Map(stations.map((s) => [s.id, s.name]));
    const allIds = new Set([...stations.map((s) => s.id), ...Object.keys(listenData)]);
    return Array.from(allIds)
      .map((id) => ({
        id,
        name: nameMap.get(id) ?? listenData[id]?.name ?? id,
        total: listenData[id]?.total ?? 0,
        today: listenData[id]?.today ?? 0,
      }))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);
  }

  function mediaSessionFields(trackInfo, stationName) {
    const station = String(stationName || 'Wavelength').trim() || 'Wavelength';
    const track = String(trackInfo || '').trim();
    if (!track) return { title: station, artist: 'Wavelength' };

    if (track.includes(' - ')) {
      const parts = track.split(' - ');
      const artist = parts[0].trim();
      const title = parts.slice(1).join(' - ').trim();
      if (artist && title) return { title, artist };
    }

    return { title: track, artist: station };
  }

  const EQ_PRESETS = {
    flat: { bass: 0, mid: 0, treble: 0 },
    rock: { bass: 5, mid: -2, treble: 4 },
    pop: { bass: -1, mid: 3, treble: 2 },
    bass: { bass: 7, mid: 0, treble: -1 },
    vocal: { bass: -3, mid: 6, treble: 2 },
    electronic: { bass: 6, mid: -3, treble: 5 },
    jazz: { bass: 3, mid: 1, treble: 2 },
    classical: { bass: -2, mid: 0, treble: 3 },
  };

  function eqPresetGains(name) {
    return EQ_PRESETS[name] ? { ...EQ_PRESETS[name] } : null;
  }

  exports.eqPresetGains = eqPresetGains;
  exports.formatListen = formatListen;
  exports.averageLevel = averageLevel;
  exports.trayState = trayState;
  exports.fakeBar = fakeBar;
  exports.getStationCategory = getStationCategory;
  exports.getLanguageLabel = getLanguageLabel;
  exports.filterStations = filterStations;
  exports.buildRecentsList = buildRecentsList;
  exports.buildStatsList = buildStatsList;
  exports.mediaSessionFields = mediaSessionFields;
})(typeof module !== 'undefined' ? module.exports : (window.utils = {}));
