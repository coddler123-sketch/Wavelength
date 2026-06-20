const fs = require('fs');

function load(stateFile, log) {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const s   = JSON.parse(raw);
    if (Number.isFinite(s.x) && Number.isFinite(s.y))
      return {
        x: s.x,
        y: s.y,
        width: Number.isFinite(s.width) ? s.width : null,
        height: Number.isFinite(s.height) ? s.height : null,
        isMini: s.isMini === true,
        dockMini: s.dockMini !== false
      };
  } catch (err) {
    if (err.code !== 'ENOENT') log('window-state-load', err.message);
  }
  return null;
}

function save(stateFile, log, win, displays, isMini, dockMini, fullWidth, fullHeight) {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const onScreen = displays.some(d => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  });
  if (!onScreen) return;
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ x, y, isMini, dockMini, width: fullWidth, height: fullHeight }));
  } catch (err) {
    log('window-state-save', err.message);
  }
}

function clear(stateFile, log) {
  try {
    fs.rmSync(stateFile, { force: true });
  } catch (err) {
    log('window-state-clear', err.message);
  }
}

module.exports = { load, save, clear };
