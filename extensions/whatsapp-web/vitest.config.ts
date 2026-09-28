import { defineConfig } from 'vitest/config';

// Tests of the extension (ADR-0038) in jsdom, with hand-built pages in src/fixtures instead of
// WhatsApp Web itself.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'jsdom'
	}
});
