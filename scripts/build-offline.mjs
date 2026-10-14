// One self-contained HTML file that runs offline from disk (double-click it): the normal Vite
// build with three.js bundled in, the script and CSS inlined, and every texture and sound embedded as
// a data URI (see src/assets.js). Output: dist-offline/stealth-sprinter-offline.html
// Fonts fall back to system fonts when there is no network.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-offline');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
execFileSync(bin, ['build', '--outDir', join(out, 'build'), '--emptyOutDir'], { cwd: root, stdio: 'inherit' });

const html = readFileSync(join(out, 'build', 'index.html'), 'utf8');
const jsSrc = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)?.[1];
const cssHref = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/)?.[1];
if (!jsSrc) throw new Error('bundle script not found in the build');
const js = readFileSync(join(out, 'build', jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = cssHref ? readFileSync(join(out, 'build', cssHref), 'utf8') : '';

const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const assets = {};
for (const dir of ['textures', 'audio']) {
  for (const f of readdirSync(join(root, 'public', dir))) {
    const m = mime[extname(f)];
    if (!m) continue; // credits and notes stay out of the page
    assets[`${dir}/${f}`] = `data:${m};base64,${readFileSync(join(root, 'public', dir, f)).toString('base64')}`;
  }
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Stealth Sprinter Camper (offline)</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>window.__ASSETS = ${JSON.stringify(assets)};</script>
<script type="module">${js}</script>
</body>
</html>
`;
const file = join(out, 'stealth-sprinter-offline.html');
writeFileSync(file, page);
rmSync(join(out, 'build'), { recursive: true, force: true });
console.log(`${file} ${(page.length / 1048576).toFixed(1)} MB, ${Object.keys(assets).length} embedded files`);
