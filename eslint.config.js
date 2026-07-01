const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

const nodeCommonjs = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: { ...globals.node },
  },
};

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'tmp/**', 'assets/**'],
  },
  js.configs.recommended,
  {
    // Repo-root tooling config files (CommonJS)
    files: ['*.config.js'],
    ...nodeCommonjs,
  },
  {
    // Main process, preload, and Node-side helper modules (CommonJS)
    files: [
      'src/main.js',
      'src/preload.js',
      'src/tray-menu.js',
      'src/stations.js',
      'src/icy-metadata-client.js',
      'src/custom-stations.js',
      'src/window-state.js',
      'scripts/**/*.js',
    ],
    ...nodeCommonjs,
  },
  {
    // UMD utility modules: used via require() in Node and as classic <script> in the browser
    files: ['src/utils.js', 'src/visualizer.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.node, ...globals.browser, module: 'writable' },
    },
  },
  {
    // Renderer ESM modules, loaded via <script type="module">
    files: ['src/renderer*.js', 'src/*.mjs', 'src/i18n.js', 'src/ui-labels.mjs', 'src/settings.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // WavelengthVisualizer is a UMD global exposed by the classic <script> visualizer.js
      globals: { ...globals.browser, WavelengthVisualizer: 'readonly' },
    },
  },
  {
    files: ['scripts/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  prettierConfig,
];
