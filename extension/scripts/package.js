// Build store-ready zips: dist/claude-split-chrome.zip + claude-split-firefox.zip.
// Chrome MV3 wants background.service_worker; Firefox MV3 wants
// background.scripts — each zip gets a manifest with only its own key.
// Requires the `zip` CLI (present on macOS/Linux/CI).

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

rmSync(distDir, { recursive: true, force: true });

for (const browser of ['chrome', 'firefox']) {
  const stageDir = join(distDir, browser);
  mkdirSync(stageDir, { recursive: true });
  cpSync(join(root, 'src'), join(stageDir, 'src'), { recursive: true });
  cpSync(join(root, '..', 'LICENSE'), join(stageDir, 'LICENSE'));
  cpSync(join(root, '..', 'NOTICES.md'), join(stageDir, 'NOTICES.md'));

  const m = structuredClone(manifest);
  if (browser === 'chrome') {
    delete m.background.scripts;
    delete m.browser_specific_settings;
  } else {
    delete m.background.service_worker;
  }
  writeFileSync(join(stageDir, 'manifest.json'), JSON.stringify(m, null, 2));

  const zipPath = join(distDir, `claude-split-${browser}.zip`);
  execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: stageDir });
  console.log(`built ${zipPath}`);
}
