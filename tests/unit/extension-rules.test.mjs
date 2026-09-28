// Folder and version of the built browser extension (ADR-0038 §4): next to pb_hooks in the app
// folder, on Windows and Linux; the version only from a Manifest V3 build.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('extension-rules.js');

describe('extension-rules.js', () => {
	it('puts the folder next to pb_hooks', () => {
		expect(rules.folderOf('H:\\DEV\\github\\becauseyoulovejira\\app\\pb_hooks')).toBe(
			'H:\\DEV\\github\\becauseyoulovejira\\app\\erweiterung-whatsapp-web'
		);
		expect(rules.folderOf('C:\\byl\\app\\pb_hooks\\')).toBe('C:\\byl\\app\\erweiterung-whatsapp-web');
		expect(rules.folderOf('/opt/byl/app/pb_hooks')).toBe('/opt/byl/app/erweiterung-whatsapp-web');
		expect(rules.folderOf('C:\\pb_hooks')).toBe('C:\\erweiterung-whatsapp-web');
		expect(rules.folderOf('/pb_hooks')).toBe('/erweiterung-whatsapp-web');
		expect(rules.folderOf('pb_hooks')).toBe('./erweiterung-whatsapp-web');
		expect(rules.folderOf('')).toBe('');
		expect(rules.FOLDER).toBe('erweiterung-whatsapp-web');
	});

	it('reads the version of a Manifest V3 build only', () => {
		expect(rules.versionOf('{"manifest_version":3,"version":"0.1.0"}')).toBe('0.1.0');
		for (const text of [
			'',
			'kein json',
			'{"manifest_version":2,"version":"0.1.0"}',
			'{"manifest_version":3}',
			'{"manifest_version":3,"version":"1.0<script>"}',
			'null'
		]) {
			expect(rules.versionOf(text), text).toBe('');
		}
	});
});
