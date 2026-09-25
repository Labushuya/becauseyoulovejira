// Mail providers of the helper against the kinds the hook accepts (E4 plan, packages 11, 13 and 22).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PROVIDERS, providerOf } from './providers';

function connectionRules(): { MAIL_PROVIDERS: string[] } {
	const filename = join(import.meta.dirname, '../../../app/pb_hooks/lib/connection-rules.js');
	const factory = runInThisContext(`(function (module, exports) {${readFileSync(filename, 'utf8')}\n})`, {
		filename
	}) as (module: { exports: unknown }, exports: unknown) => void;
	const module = { exports: {} as { MAIL_PROVIDERS: string[] } };
	factory(module, module.exports);
	return module.exports;
}

describe('providers', () => {
	it('knows exactly the providers the hook accepts', () => {
		expect(Object.keys(PROVIDERS)).toEqual(connectionRules().MAIL_PROVIDERS);
	});

	it('reaches Web.de over IMAP with TLS on port 993 and explains a refused login', () => {
		expect(providerOf('webde')).toMatchObject({ host: 'imap.web.de', port: 993, secure: true });
		expect(providerOf('webde')?.loginHint).toMatch(/POP3- und IMAP-Zugriff erlauben/);
		expect(providerOf('webde')?.loginHint).toMatch(/anwendungsspezifisches Passwort/);
		expect(providerOf('toString')).toBeNull();
	});

	it('reaches Gmail over IMAP with TLS on port 993 and asks for an app password after a refused login', () => {
		expect(providerOf('gmail')).toMatchObject({ label: 'Gmail', host: 'imap.gmail.com', port: 993, secure: true });
		const hint = providerOf('gmail')?.loginHint ?? '';
		expect(hint.startsWith('App-Passwort nötig (Bestätigung in zwei Schritten)')).toBe(true);
		expect(hint).toContain('myaccount.google.com/apppasswords');
		expect(hint).toMatch(/setx/);
		expect(hint.length).toBeLessThanOrEqual(1000);
		expect(providerOf('proton')).toBeNull();
	});
});
