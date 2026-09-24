import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Local PocketBase instance (CLAUDE.md section 3).
const POCKETBASE = 'http://127.0.0.1:8090';

export default defineConfig({
	// svelteTesting only acts under Vitest: browser builds of Svelte, DOM cleanup after each test.
	plugins: [sveltekit(), svelteTesting()],
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
