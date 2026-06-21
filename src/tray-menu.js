function stationMenuItem(station, activeStation, onSelect) {
  return {
    label: station.name,
    type: 'radio',
    checked: !!(activeStation && activeStation.id === station.id),
    click: () => onSelect(station),
  };
}

function trayStationGroupLabel(station) {
  const first = String(station.name || '').trim().charAt(0).toLocaleUpperCase('de');
  return /^[A-ZÄÖÜ]$/.test(first) ? first : '0-9';
}

function buildTrayStationMenuItems(stations, activeStation, onSelect, groupThreshold = 40) {
  const trayStations = [...stations].sort((a, b) =>
    a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

  if (trayStations.length <= groupThreshold) {
    return trayStations.map(station => stationMenuItem(station, activeStation, onSelect));
  }

  const groups = new Map();
  for (const station of trayStations) {
    const label = trayStationGroupLabel(station);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(station);
  }

  return Array.from(groups, ([label, groupStations]) => {
    const hasActiveStation = groupStations.some(station => activeStation && station.id === activeStation.id);
    return {
      label: hasActiveStation ? `• ${label}` : label,
      submenu: groupStations.map(station => stationMenuItem(station, activeStation, onSelect)),
    };
  });
}

function stationSwitcherSubmenu(stationMenuItems, activeStation) {
  if (stationMenuItems.length === 0) return [{ label: 'Lade Stationen...', enabled: false }];
  if (!activeStation) return stationMenuItems;
  return [
    { label: `Aktuell: ${activeStation.name}`, enabled: false },
    { type: 'separator' },
    ...stationMenuItems,
  ];
}

module.exports = {
  buildTrayStationMenuItems,
  stationSwitcherSubmenu,
  trayStationGroupLabel,
};
