const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (startIndex === -1) throw new Error(`No CHANGELOG.md entry for v${version}`);

  const nextHeading = lines.slice(startIndex + 1).findIndex((line) => /^## /.test(line));
  const endIndex = nextHeading === -1 ? lines.length : startIndex + 1 + nextHeading;
  return lines
    .slice(startIndex + 1, endIndex)
    .join('\n')
    .trim();
}

function githubReleaseArgs(version, notes, assets) {
  const tag = `v${version}`;
  return ['release', 'create', tag, '--title', `Wavelength ${tag}`, '--notes', notes, ...assets];
}

function main(argv = process.argv.slice(2)) {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const notes = extractReleaseNotes(changelog, pkg.version);

  if (argv[0] !== '--gh-release') {
    process.stdout.write(notes + '\n');
    return;
  }

  const requiredAssets = [
    path.join(root, 'dist', `Wavelength-Setup-${pkg.version}.exe`),
    path.join(root, 'dist', `Wavelength-Setup-${pkg.version}.exe.blockmap`),
    path.join(root, 'dist', 'latest.yml'),
    path.join(root, 'dist', `Wavelength-${pkg.version}-portable.exe`),
  ];
  const assets = requiredAssets.filter((asset) => fs.existsSync(asset));

  if (assets.length !== requiredAssets.length) {
    const missing = requiredAssets.filter((asset) => !fs.existsSync(asset));
    throw new Error(`Release is missing build artifacts in dist/: ${missing.join(', ')}`);
  }

  execFileSync('gh', githubReleaseArgs(pkg.version, notes, assets), { stdio: 'inherit' });
  console.log(`Created GitHub release v${pkg.version}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { extractReleaseNotes, githubReleaseArgs };
