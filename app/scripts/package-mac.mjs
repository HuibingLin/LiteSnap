#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.error('package:mac can only run on macOS.');
  process.exit(1);
}

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

const bundleDir = path.join(
  rootDir,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'macos',
);
const appBundlePath = path.join(bundleDir, 'LiteSnap.app');
const outputDir = path.join(rootDir, 'release', 'mac');

if (!fs.existsSync(appBundlePath)) {
  console.error(`Missing app bundle: ${appBundlePath}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const zipPath = path.join(outputDir, `LiteSnap-${version}-${arch}.zip`);
execFileSync(
  'ditto',
  ['-c', '-k', '--sequesterRsrc', '--keepParent', appBundlePath, zipPath],
  { stdio: 'inherit' },
);

const dmgFiles = fs
  .readdirSync(bundleDir)
  .filter((file) => file.toLowerCase().endsWith('.dmg'))
  .map((file) => {
    const fullPath = path.join(bundleDir, file);
    return {
      file,
      fullPath,
      stat: fs.statSync(fullPath),
    };
  })
  .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

if (dmgFiles.length > 0) {
  const dmgSource = dmgFiles[0].fullPath;
  const dmgPath = path.join(outputDir, `LiteSnap-${version}-${arch}.dmg`);
  fs.copyFileSync(dmgSource, dmgPath);
}

console.log(`Created: ${zipPath}`);
if (dmgFiles.length > 0) {
  console.log(`Copied: ${path.join(outputDir, `LiteSnap-${version}-${arch}.dmg`)}`);
}
