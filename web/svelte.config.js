import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Staging folder (ADR-0040): scripts/publish-web.mjs moves the build into app/pb_public
		// without a gap and keeps the files of older builds for tabs that still run them.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		// Every build gets its own version (the default name is the build time); open tabs ask for
		// _app/version.json once a minute and then offer "Neu laden" (ADR-0040).
		version: {
			pollInterval: 60_000
		}
	}
};

export default config;
