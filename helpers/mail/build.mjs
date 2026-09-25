// Builds byl-mail.exe as single executable application of the running Node 24 (ADR-0016 section 5):
// esbuild bundles src/cli.ts with imapflow, postal-mime and the shared domain modules of the web
// app into one CommonJS file, Node writes the preparation blob, postject injects it into a copy of
// node.exe. Output in dist/; scripts/build-mail-helper.ps1 checks the executable and installs it
// into app/. Nothing here touches app/.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');
const BUNDLE = join(DIST, 'byl-mail.cjs');
const BLOB = join(DIST, 'sea-prep.blob');
const CONFIG = join(DIST, 'sea-config.json');
const EXE = join(DIST, 'byl-mail.exe');
// Fixed sentinel of Node's single executable applications.
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const major = Number(process.versions.node.split('.')[0]);
if (major !== 24) {
	throw new Error(`byl-mail.exe is built with Node 24; this is Node ${process.versions.node}.`);
}

const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
	entryPoints: [join(HERE, 'src', 'cli.ts')],
	outfile: BUNDLE,
	bundle: true,
	platform: 'node',
	target: 'node24',
	format: 'cjs',
	minify: true,
	define: { __BYL_MAIL_VERSION__: JSON.stringify(version) },
	logLevel: 'warning'
});

writeFileSync(
	CONFIG,
	JSON.stringify(
		{
			main: BUNDLE,
			output: BLOB,
			disableExperimentalSEAWarning: true,
			useSnapshot: false,
			useCodeCache: false,
			// NODE_OPTIONS of the user environment must not change the helper.
			execArgvExtension: 'none'
		},
		null,
		2
	)
);
execFileSync(process.execPath, ['--experimental-sea-config', CONFIG], { stdio: 'inherit' });

copyFileSync(process.execPath, EXE);
await inject(EXE, 'NODE_SEA_BLOB', readFileSync(BLOB), { sentinelFuse: SENTINEL_FUSE });

const megabytes = (statSync(EXE).size / 1024 / 1024).toFixed(1);
console.log(`byl-mail ${version}: ${EXE} (${megabytes} MB, bundle ${(statSync(BUNDLE).size / 1024).toFixed(0)} kB)`);
