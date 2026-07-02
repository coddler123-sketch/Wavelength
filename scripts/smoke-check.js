const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const readme = read('README.md');
const releaseChecklist = read('RELEASE_CHECKLIST.md');
const stationsJson = JSON.parse(read('assets/stations.json'));
const { validateStations } = require('./validate-stations.js');
const stationErrors = validateStations(stationsJson);
assert(stationErrors.length === 0, `assets/stations.json validation failed: ${stationErrors.join('; ')}`);
assert(Array.isArray(stationsJson) && stationsJson.length >= 10, 'assets/stations.json: zu wenige Stationen');
for (const s of stationsJson) {
  assert(
    s.id && s.name && s.streamUrl && s.genre && s.country && s.language,
    `assets/stations.json: Station "${s.name || s.id}" fehlt Pflichtfelder`
  );
  assert(s.streamUrl.startsWith('https://'), `assets/stations.json: "${s.name}" nutzt kein HTTPS`);
}
const html = read('src/index.html');
const changelog = read('CHANGELOG.md');
const main = read('src/main.js');
const icyMetadataClient = read('src/icy-metadata-client.js');
const preload = read('src/preload.js');
const renderer = [
  read('src/renderer-state.js'),
  read('src/renderer-ui.js'),
  read('src/renderer-audio.js'),
  read('src/renderer-stations.js'),
  read('src/renderer.js'),
].join('\n');
const utils = read('src/utils.js');
const winState = read('src/window-state.js');
const visualizer = read('src/visualizer.js');
const stationGain = read('src/station-gain.mjs');
const rendererSanitize = read('src/renderer-sanitize.mjs');
const uiLabels = read('src/ui-labels.mjs');
const stationSelection = read('src/station-selection.mjs');
const reconnectPolicy = read('src/reconnect-policy.mjs');
const uiAudit = read('scripts/ui-audit.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(pkg.version === lock.version, 'package-lock version mismatch');
assert(pkg.version === lock.packages[''].version, 'package-lock root version mismatch');
assert(changelog.includes(`## ${pkg.version}`), `CHANGELOG.md missing entry for v${pkg.version}`);
assert(
  readme.includes(`Current version: \`${pkg.version}\``),
  `README.md missing current version ${pkg.version}`
);
assert(readme.includes('npm.cmd run verify'), 'README.md missing verify command');
assert(readme.includes('npm.cmd run build'), 'README.md missing build command');
assert(readme.includes('intentionally unsigned'), 'README.md missing unsigned installer note');
assert(readme.includes('RELEASE_CHECKLIST.md'), 'README.md missing release checklist link');
assert(releaseChecklist.includes('npm.cmd run verify'), 'RELEASE_CHECKLIST.md missing verify step');
assert(releaseChecklist.includes('Ask before building'), 'RELEASE_CHECKLIST.md missing build approval step');
assert(
  releaseChecklist.includes('%APPDATA%\\wavelength\\logs\\app.log'),
  'RELEASE_CHECKLIST.md missing log check'
);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
assert(duplicateIds.length === 0, `duplicate HTML ids: ${duplicateIds.join(', ')}`);

for (const id of [
  'audio',
  'visualizer',
  'mini-station-subtitle',
  'viz-toast',
  'live-status',
  'listen-badge',
  'btn-bass',
  'station-gain-pill',
  'station-search',
  'station-list',
]) {
  assert(ids.includes(id), `missing HTML id: ${id}`);
}

for (const channel of [
  'play-pause',
  'toggle-mini',
  'toggle-mute',
  'cycle-sleep-timer',
  'connection-state',
  'get-stations',
  'select-station',
]) {
  assert(main.includes(channel), `main missing IPC channel: ${channel}`);
  assert(preload.includes(channel), `preload missing IPC channel: ${channel}`);
}

for (const marker of ['showToast', 'BASS_GAINS', 'WavelengthVisualizer.create']) {
  assert(renderer.includes(marker), `renderer missing marker: ${marker}`);
}
assert(utils.includes('getStationCategory'), 'utils.js missing getStationCategory');
assert(utils.includes('filterStations'), 'utils.js missing filterStations');
assert(utils.includes('buildRecentsList'), 'utils.js missing buildRecentsList');

assert(html.includes('src="utils.js"'), 'index.html missing utils.js script tag');
assert(html.includes('src="visualizer.js"'), 'index.html missing visualizer.js script tag');
assert(
  html.indexOf('src="visualizer.js"') > html.indexOf('src="utils.js"'),
  'visualizer.js must load after utils.js'
);
assert(
  html.indexOf('src="renderer.js"') > html.indexOf('src="visualizer.js"'),
  'renderer.js must load after visualizer.js'
);
assert(utils.includes('formatListen'), 'utils.js missing formatListen');
assert(utils.includes('averageLevel'), 'utils.js missing averageLevel');
assert(renderer.includes('window.utils'), 'renderer modules not importing from utils module');
assert(winState.includes('load'), 'window-state.js missing load');
assert(winState.includes('save'), 'window-state.js missing save');
assert(winState.includes('clear'), 'window-state.js missing clear');
assert(main.includes("require('./window-state.js')"), 'main.js not importing window-state');
assert(main.includes("require('./icy-metadata-client.js')"), 'main.js not importing icy metadata client');
assert(icyMetadataClient.includes('createIcyMetadataClient'), 'icy-metadata-client.js missing factory');
assert(icyMetadataClient.includes('StreamTitle'), 'icy-metadata-client.js missing ICY StreamTitle parser');
assert(visualizer.includes('VISUALIZER_MODES'), 'visualizer.js missing visualizer modes');
assert(visualizer.includes('function create'), 'visualizer.js missing create function');
assert(visualizer.includes('drawMiniSignal'), 'visualizer.js missing mini signal renderer');
assert(stationGain.includes('gainDbToLinear'), 'station-gain.mjs missing dB conversion');
assert(rendererSanitize.includes('escapeHtml'), 'renderer-sanitize.mjs missing HTML escaping');
assert(rendererSanitize.includes('safeHttpUrl'), 'renderer-sanitize.mjs missing URL sanitizer');
assert(uiLabels.includes('connectionLabel'), 'ui-labels.mjs missing connection labels');
assert(
  stationSelection.includes('shouldSuppressMainAutoplay'),
  'station-selection.mjs missing main autoplay policy'
);
assert(
  reconnectPolicy.includes('reconnectDelayForAttempt'),
  'reconnect-policy.mjs missing reconnect delay policy'
);
assert(uiAudit.includes('auditVisualizerModes'), 'ui-audit.js missing visualizer mode render audit');
assert(uiAudit.includes('getImageData'), 'ui-audit.js must inspect canvas pixels');

console.log(`smoke-check ok v${pkg.version}`);
