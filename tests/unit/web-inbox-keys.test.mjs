// Access keys of the own inbox (ADR-0038): the web app (web/src/lib/domain/inbox-keys.ts) and the
// hook (app/pb_hooks/lib/inbox-key-rules.js) check names alike and share their texts; the example
// requests of the help send what the hook accepts.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	INBOX_INGEST_ROUTE,
	INBOX_KEYS_MAX,
	INBOX_KEY_MESSAGES,
	INBOX_KEY_NAME_MAX_LENGTH,
	ingestExamples,
	inboxKeyNameError
} from '../../web/src/lib/domain/inbox-keys.ts';

const rules = loadHookLib('inbox-key-rules.js');

describe('web inbox keys and inbox-key-rules.js', () => {
	it('share limits and texts', () => {
		expect(INBOX_KEY_NAME_MAX_LENGTH).toBe(rules.NAME_MAX_LENGTH);
		expect(INBOX_KEYS_MAX).toBe(rules.MAX_KEYS_PER_USER);
		expect(INBOX_KEY_MESSAGES.validation_inbox_key_name).toBe(rules.MESSAGES.name);
		expect(INBOX_KEY_MESSAGES.validation_inbox_key_limit).toBe(rules.MESSAGES.tooMany);
	});

	it('check names alike', () => {
		for (const name of ['', '  ', 'Rechner', '  Mein   Rechner ', 'x'.repeat(60), 'x'.repeat(61), ' '.repeat(3) + 'x'.repeat(60)]) {
			const hook = rules.parseName(name);
			expect(inboxKeyNameError(name) === null, JSON.stringify(name)).toBe(hook.error === undefined);
		}
	});

	it('give examples the hook accepts, with the key as placeholder', () => {
		const { powershell, curl } = ingestExamples('http://127.0.0.1:8090');
		for (const example of [powershell, curl]) {
			expect(example).toContain(`http://127.0.0.1:8090${INBOX_INGEST_ROUTE}`);
			expect(example).toContain('Bearer {{schluessel}}');
		}
		const json = /-d "(.*)"$/.exec(curl)?.[1]?.replaceAll('\\"', '"');
		expect(rules.parsePayload(JSON.parse(json)).draft).toMatchObject({ channel: 'api', mode: 'manual', body: 'Milch kaufen', source_ref: 'einkauf-1' });
		expect(powershell).toContain("[System.Text.Encoding]::UTF8.GetBytes($body)");
		expect(powershell).toContain("mode = 'manual'; text = 'Milch kaufen'; external_id = 'einkauf-1'");
	});
});
