const { execSync } = require('child_process');
const fs = require('fs');

const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: npm run release:<patch|minor|major>');
  process.exit(1);
}

// 1. Bump version
execSync(`node scripts/bump-version.js ${type}`, { stdio: 'inherit' });

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
console.log(`\nReleasing v${version}...\n`);

// 2. Auto-generate changelog entry from commits since last release
const lastRelease = execSync(
  'git log --oneline --format="%H" -- CHANGELOG.md | head -1',
  { encoding: 'utf8' }
).trim();

const logCmd = lastRelease
  ? `git log ${lastRelease}..HEAD --format="- %s" --no-merges`
  : 'git log -10 --format="- %s" --no-merges';

const commits = execSync(logCmd, { encoding: 'utf8' }).trim();

const changelogPath = 'CHANGELOG.md';
const existing = fs.readFileSync(changelogPath, 'utf8');

// Skip if entry already exists
if (!existing.includes(`## ${version}`)) {
  const entry = `## ${version}\n\n${commits || '- Bugfixes und Verbesserungen'}\n\n`;
  fs.writeFileSync(changelogPath, existing.replace('# Changelog\n\n', `# Changelog\n\n${entry}`));
  console.log(`Changelog entry for v${version} generated.`);
}

// 3. Verify
console.log('Running verify...');
execSync('npm run verify', { stdio: 'inherit' });

// 4. Commit + push
execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "chore: release v${version}"`, { stdio: 'inherit' });
execSync('git push origin main', { stdio: 'inherit' });

// 5. Build
console.log('\nBuilding installer...');
execSync('npm run build', { stdio: 'inherit' });

console.log(`\nDone! v${version} released and built.`);
