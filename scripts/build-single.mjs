// Inline the Vite build into one self-contained HTML file (dist/stealth-sprinter.html):
// CSS and JS are embedded, only Google Fonts stays external.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const cssHref = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/)?.[1];
const jsSrc = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)?.[1];
if (!jsSrc) throw new Error('bundle script not found in dist/index.html');
const css = cssHref ? readFileSync(join(dist, cssHref), 'utf8') : '';
const js = readFileSync(join(dist, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)?.[0] || '';
const out = `<title>Stealth Sprinter Camper</title>
<meta name="description" content="Interactive, engineering-checked 3D model of a four-season off-grid Mercedes-Benz Sprinter 170 high-roof stealth camper.">
${fonts}
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
writeFileSync(join(dist, 'stealth-sprinter.html'), out);
console.log(`dist/stealth-sprinter.html ${(out.length / 1024).toFixed(0)} KB`);
