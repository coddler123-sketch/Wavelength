const TRAY_STRINGS = {
  de: {
    loading: 'Lade Stationen…',
    current: (name) => `Aktuell: ${name}`,
    play: '▶  Abspielen',
    stop: '⏹  Stoppen',
    switchStation: 'Station wechseln',
    sleep: 'Sleeptimer',
    sleepMin: (min) => `${min} Minuten`,
    sleepCancel: 'Abbrechen',
    mute: 'Stumm',
    pin: 'Anheften (immer im Vordergrund)',
    mini: 'Mini-Player',
    full: 'Vollansicht',
    dock: 'Mini an Bildschirmkante andocken',
    show: 'Anzeigen',
    hide: 'Ausblenden',
    autostart: 'Autostart',
    reset: 'Zurücksetzen',
    resetWin: 'Fensterposition zurücksetzen',
    resetApp: 'Einstellungen zurücksetzen',
    shortcuts: 'Tastaturkürzel',
    about: 'Über Wavelength',
    update: (v) => `⬆  Update v${v} installieren`,
    quit: 'Beenden',
  },
  en: {
    loading: 'Loading stations…',
    current: (name) => `Now: ${name}`,
    play: '▶  Play',
    stop: '⏹  Stop',
    switchStation: 'Switch station',
    sleep: 'Sleep timer',
    sleepMin: (min) => `${min} minutes`,
    sleepCancel: 'Cancel',
    mute: 'Mute',
    pin: 'Pin (always on top)',
    mini: 'Mini player',
    full: 'Full view',
    dock: 'Snap mini to screen edge',
    show: 'Show',
    hide: 'Hide',
    autostart: 'Autostart',
    reset: 'Reset',
    resetWin: 'Reset window position',
    resetApp: 'Reset settings',
    shortcuts: 'Keyboard shortcuts',
    about: 'About Wavelength',
    update: (v) => `⬆  Install update v${v}`,
    quit: 'Quit',
  },
};

let _lang = 'de';
function setTrayLang(lang) {
  _lang = lang === 'en' ? 'en' : 'de';
}
function tr() {
  return TRAY_STRINGS[_lang] || TRAY_STRINGS.de;
}

function stationMenuItem(station, activeStation, onSelect) {
  return {
    label: station.name,
    type: 'radio',
    checked: !!(activeStation && activeStation.id === station.id),
    click: () => onSelect(station),
  };
}

function trayStationGroupLabel(station) {
  const first = String(station.name || '')
    .trim()
    .charAt(0)
    .toLocaleUpperCase('de');
  return /^[A-ZÄÖÜ]$/.test(first) ? first : '0-9';
}

function buildTrayStationMenuItems(stations, activeStation, onSelect, groupThreshold = 40) {
  const trayStations = [...stations].sort((a, b) =>
    a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
  );

  if (trayStations.length <= groupThreshold) {
    return trayStations.map((station) => stationMenuItem(station, activeStation, onSelect));
  }

  const groups = new Map();
  for (const station of trayStations) {
    const label = trayStationGroupLabel(station);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(station);
  }

  return Array.from(groups, ([label, groupStations]) => {
    const hasActiveStation = groupStations.some(
      (station) => activeStation && station.id === activeStation.id
    );
    return {
      label: hasActiveStation ? `• ${label}` : label,
      submenu: groupStations.map((station) => stationMenuItem(station, activeStation, onSelect)),
    };
  });
}

function stationSwitcherSubmenu(stationMenuItems, activeStation) {
  const s = tr();
  if (stationMenuItems.length === 0) return [{ label: s.loading, enabled: false }];
  if (!activeStation) return stationMenuItems;
  return [
    { label: s.current(activeStation.name), enabled: false },
    { type: 'separator' },
    ...stationMenuItems,
  ];
}

module.exports = {
  buildTrayStationMenuItems,
  stationSwitcherSubmenu,
  trayStationGroupLabel,
  setTrayLang,
  tr,
};
