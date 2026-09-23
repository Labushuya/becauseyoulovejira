import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					include: ['tests/unit/**/*.test.{js,mjs,ts}'],
					environment: 'node'
				}
			},
			{
				test: {
					name: 'integration',
					include: ['tests/integration/**/*.test.{js,mjs,ts}'],
					environment: 'node',
					globalSetup: ['tests/support/global-setup.mjs'],
					// Node 24 ships EventSource only behind this flag; the PocketBase SDK needs it for
					// realtime subscriptions (OF-13: no polyfill dependency). The experimental warning is muted.
					execArgv: ['--experimental-eventsource', '--disable-warning=UNDICI-ES'],
					testTimeout: 15_000,
					hookTimeout: 30_000
				}
			}
		]
	}
});
