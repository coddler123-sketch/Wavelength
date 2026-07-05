const { execFileSync } = require('child_process');
const fs = require('fs');

const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: npm run release:<patch|minor|major>');
  process.exit(1);
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
const capture = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

if (capture('git', ['status', '--porcelain'])) {
  console.error('Release aborted: working tree is not clean.');
  process.exit(1);
}

const branch = capture('git', ['branch', '--show-current']);
if (branch !== 'main') {
  console.error(`Release aborted: expected branch main, found ${branch || 'detached HEAD'}.`);
  process.exit(1);
}

const currentVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const [major, minor, patch] = currentVersion.split('.').map(Number);
const version =
  type === 'major'
    ? `${major + 1}.0.0`
    : type === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
const tag = `v${version}`;

try {
  capture('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
  console.error(`Release aborted: tag ${tag} already exists.`);
  process.exit(1);
} catch {}

run(process.execPath, ['scripts/bump-version.js', type]);
console.log(`\nPreparing ${tag}...\n`);

let lastRelease = '';
try {
  lastRelease = capture('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
} catch {}

const logArgs = ['log'];
if (lastRelease) logArgs.push(`${lastRelease}..HEAD`);
else logArgs.push('-10');
logArgs.push('--format=- %s', '--no-merges');
const commits = capture('git', logArgs);

const changelogPath = 'CHANGELOG.md';
const existing = fs.readFileSync(changelogPath, 'utf8');
if (!existing.includes(`## ${version}`)) {
  const entry = `## ${version}\n\n${commits || '- Bugfixes und Verbesserungen'}\n\n`;
  fs.writeFileSync(changelogPath, existing.replace('# Changelog\n\n', `# Changelog\n\n${entry}`));
  console.log(`Changelog entry for ${tag} generated.`);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run releases through npm.');
const runNpm = (script) => run(process.execPath, [npmCli, 'run', script]);
console.log('\nRunning release checks...');
runNpm('verify');
runNpm('e2e');

console.log('\nBuilding installer...');
runNpm('build');

run('git', ['add', 'package.json', 'package-lock.json', 'src/index.html', 'README.md', 'CHANGELOG.md']);
run('git', ['commit', '-m', `chore: release ${tag}`]);
run('git', ['tag', '-a', tag, '-m', `Wavelength ${tag}`]);
run('git', ['push', '--atomic', 'origin', 'main', `refs/tags/${tag}`]);

console.log('\nPublishing GitHub release...');
try {
  runNpm('release:gh');
  console.log(`\nDone! ${tag} built, tagged, pushed, and published on GitHub.`);
} catch (err) {
  console.error(`\nGitHub release publish failed: ${err.message}`);
  console.error(
    `${tag} was built, tagged, and pushed, but is NOT published on GitHub yet — the auto-updater ` +
      'will 404 until you publish it. Run manually:\n' +
      `  npm run release:gh`
  );
}
