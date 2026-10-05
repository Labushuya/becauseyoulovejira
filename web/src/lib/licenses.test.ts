// License notices the app ships (AR-4): the minified build keeps no license comments, so
// static/licenses.txt carries the license of the copied symbols (Lucide, Feather), and Vite writes
// those of the bundled packages, the fonts included, into licenses-libraries.txt next to it. That
// both are in the build and served checks tests/integration/web-app.test.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(import.meta.dirname, '..', '..');
const read = (...parts: string[]) =>
	readFileSync(join(WEB, ...parts), 'utf8').replace(/\r\n/g, '\n');
const SHIPPED = read('static', 'licenses.txt');

describe('licenses.txt (AR-4)', () => {
	it('carries the whole license of the symbols as the file next to their source has it', () => {
		const source = read('src', 'lib', 'domain', 'charm-icons.LICENSE.txt');
		const license = source.slice(source.indexOf('ISC License')).trim();
		expect(license).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
		expect(license).toContain('Copyright (c) 2013-present Cole Bemis');
		expect(SHIPPED).toContain(license);
		expect(SHIPPED).toContain('lucide-static, Version 1.52.0');
		for (const file of ['charm-icons.ts', 'pin-icon.ts']) {
			expect(read('src', 'lib', 'domain', file), file).toContain(
				'@license lucide-static v1.52.0 - ISC'
			);
		}
	});

	it('names the fonts and points to the licenses Vite writes for the bundled packages', () => {
		expect(read('vite.config.ts')).toContain("license: { fileName: 'licenses-libraries.txt' }");
		expect(SHIPPED).toContain('licenses-libraries.txt');
		for (const name of [
			'Inter',
			'JetBrains Mono',
			'SIL Open Font License 1.1',
			'@fontsource-variable/inter',
			'@fontsource-variable/jetbrains-mono'
		]) {
			expect(SHIPPED, name).toContain(name);
		}
	});
});
