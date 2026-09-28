// The manifest of the extension asks for as little as possible (ADR-0038 §3): storage, WhatsApp
// Web and the app on this machine; no other page, no remote code, nothing that pages could call.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../static/manifest.json';

const HERE = import.meta.dirname;

describe('manifest.json', () => {
	it('is Manifest V3 with minimal permissions', () => {
		expect(manifest.manifest_version).toBe(3);
		expect(manifest.permissions).toEqual(['storage']);
		expect(manifest.host_permissions).toEqual([
			'https://web.whatsapp.com/*',
			'http://127.0.0.1/*',
			'http://localhost/*'
		]);
		expect(manifest.content_scripts).toEqual([
			expect.objectContaining({ matches: ['https://web.whatsapp.com/*'], all_frames: false })
		]);
		for (const key of [
			'externally_connectable',
			'web_accessible_resources',
			'optional_permissions'
		]) {
			expect(manifest, key).not.toHaveProperty(key);
		}
		expect(manifest.content_security_policy.extension_pages).toBe(
			"script-src 'self'; object-src 'self'"
		);
	});

	it('names only files the build creates', () => {
		const scripts = [
			manifest.background.service_worker,
			...manifest.content_scripts.flatMap((script) => script.js)
		];
		for (const script of scripts) {
			expect(existsSync(join(HERE, script.replace(/\.js$/, '.ts'))), script).toBe(true);
		}
		for (const file of [
			manifest.action.default_popup,
			manifest.options_ui.page,
			...manifest.content_scripts.flatMap((script) => script.css)
		]) {
			expect(existsSync(join(HERE, '..', 'static', file)), file).toBe(true);
		}
		const page = readFileSync(join(HERE, '..', 'static', 'options.html'), 'utf8');
		expect(page).toContain('<script src="options.js"></script>');
		// Nothing is loaded from outside.
		expect(page).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\//i);
	});
});
