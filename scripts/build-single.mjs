// Inline the SINGLE=1 Vite build into one self-contained HTML page (dist-single/stealth-sprinter.html).
// three.js (pinned) is resolved from jsDelivr through an import map; everything else is embedded.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-single');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const three = pkg.dependencies.three.replace(/^[^0-9]*/, '');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const cssHref = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/)?.[1];
const jsSrc = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)?.[1];
if (!jsSrc) throw new Error('bundle script not found in dist-single/index.html');
const css = cssHref ? readFileSync(join(dist, cssHref), 'utf8') : '';
const js = readFileSync(join(dist, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)?.[0] || '';
const cdn = `https://cdn.jsdelivr.net/npm/three@${three}`;
const importmap = JSON.stringify({ imports: { three: `${cdn}/build/three.module.js`, 'three/examples/jsm/': `${cdn}/examples/jsm/` } });
const out = `<title>Stealth Sprinter Camper</title>
<meta name="description" content="Interactive, engineering-checked 3D model of a four-season off-grid Mercedes-Benz Sprinter 170 high-roof stealth camper.">
${fonts}
<style>${css}</style>
<div id="app"></div>
<script type="importmap">${importmap}</script>
<script type="module">${js}</script>
`;
writeFileSync(join(dist, 'stealth-sprinter.html'), out);
console.log(`dist-single/stealth-sprinter.html ${(out.length / 1024).toFixed(0)} KB (three@${three} from jsDelivr)`);
