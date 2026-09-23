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
					testTimeout: 15_000,
					hookTimeout: 30_000
				}
			}
		]
	}
});
