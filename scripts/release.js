const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: npm run release:<patch|minor|major>');
  process.exit(1);
}

// 1. Bump version
execSync(`node scripts/bump-version.js ${type}`, { stdio: 'inherit' });

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
console.log(`\nReleasing v${version}...\n`);

// 2. Verify
console.log('Running verify...');
execSync('npm run verify', { stdio: 'inherit' });

// 3. Commit + push
execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "chore: release v${version}"`, { stdio: 'inherit' });
execSync('git push origin main', { stdio: 'inherit' });

// 4. Build
console.log('\nBuilding installer...');
execSync('npm run build', { stdio: 'inherit' });

console.log(`\nDone! v${version} released and built.`);
