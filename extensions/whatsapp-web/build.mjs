// Builds the browser extension "becauseyoulovejira für WhatsApp Web" (ADR-0038 §3) into the
// folder app/erweiterung-whatsapp-web, which the user loads in Chrome or Edge with "Entpackte
// Erweiterung laden". esbuild bundles the three scripts (service worker, content script,
// settings page) without minifying, so the code stays readable; the static files are copied and
// the manifest gets the version of package.json. The folder is gitignored like the rest of the
// build output in app/.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const OUT = join(ROOT, 'app', 'erweiterung-whatsapp-web');
const STATIC = join(HERE, 'static');
const ICON = join(ROOT, 'web', 'static', 'icons', 'icon-192.png');

const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'icons'), { recursive: true });

await build({
	entryPoints: {
		background: join(HERE, 'src', 'background.ts'),
		content: join(HERE, 'src', 'content.ts'),
		options: join(HERE, 'src', 'options.ts')
	},
	outdir: OUT,
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'chrome116',
	minify: false,
	legalComments: 'none',
	logLevel: 'warning'
});

for (const file of ['options.html', 'options.css', 'content.css']) {
	copyFileSync(join(STATIC, file), join(OUT, file));
}
copyFileSync(ICON, join(OUT, 'icons', 'icon.png'));

const manifest = JSON.parse(readFileSync(join(STATIC, 'manifest.json'), 'utf8'));
manifest.version = version;
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

// Every file the manifest names must exist, or the browser refuses to load the folder.
const named = [
	manifest.background.service_worker,
	manifest.action.default_popup,
	manifest.options_ui.page,
	...Object.values(manifest.icons),
	...manifest.content_scripts.flatMap((script) => [...script.js, ...script.css])
];
const missing = named.filter((file) => !existsSync(join(OUT, file)));
if (missing.length > 0) {
	throw new Error(`Missing in the build of the extension: ${missing.join(', ')}`);
}
process.stdout.write(`Extension ${version} built in ${OUT}\n`);
