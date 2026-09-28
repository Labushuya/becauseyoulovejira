import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

// Lint of the extension (ADR-0038): the same base as the web app, without Svelte.
export default defineConfig(
	{ ignores: ['node_modules/'] },
	js.configs.recommended,
	ts.configs.recommended,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// TypeScript checks names; see the web app.
			'no-undef': 'off',
			// No console output, so neither the key nor a message ends up in the console of the page.
			'no-console': 'error'
		}
	}
);
