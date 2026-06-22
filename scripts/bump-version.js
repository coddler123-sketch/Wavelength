const fs = require('fs');
const path = require('path');

const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: node scripts/bump-version.js <patch|minor|major>');
  process.exit(1);
}

const pkgPath = path.join(__dirname, '..', 'package.json');
const lockPath = path.join(__dirname, '..', 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const prev = pkg.version;
const [major, minor, patch] = prev.split('.').map(Number);
let next;
if (type === 'major') next = `${major + 1}.0.0`;
else if (type === 'minor') next = `${major}.${minor + 1}.0`;
else next = `${major}.${minor}.${patch + 1}`;

pkg.version = next;
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;

const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const updatedHtml = html.replace(
  /(<p[^>]+id="about-version"[^>]*>)v[\d.]+(<\/p>)/,
  `$1v${next}$2`
);
if (updatedHtml === html) {
  console.error('Warning: about-version not found in index.html');
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
fs.writeFileSync(htmlPath, updatedHtml);

console.log(`${prev} → ${next} (${type})`);
