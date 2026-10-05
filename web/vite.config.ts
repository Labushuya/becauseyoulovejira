import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Local PocketBase instance (CLAUDE.md section 3).
const POCKETBASE = 'http://127.0.0.1:8090';

export default defineConfig({
	// svelteTesting only acts under Vitest: browser builds of Svelte, DOM cleanup after each test.
	plugins: [sveltekit(), svelteTesting()],
	// The minified build keeps no license comments: Vite writes the license of every bundled package
	// (libraries and the fonts of @fontsource-variable) next to index.html; static/licenses.txt names
	// the copied symbols and points there (AR-4).
	build: {
		license: { fileName: 'licenses-libraries.txt' }
	},
	// `vite dev` only: the SPA calls PocketBase on its own origin, so API and admin UI requests
	// are forwarded to the local instance. "/_/" instead of "/_" keeps SvelteKit's "/_app" local.
	server: {
		proxy: {
			'/api': POCKETBASE,
			'/_/': POCKETBASE
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'jsdom',
		unstubGlobals: true
	}
});
