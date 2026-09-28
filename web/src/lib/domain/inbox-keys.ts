// Own inbox with access keys (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1). Pure: the texts
// of the hook (app/pb_hooks/lib/inbox-key-rules.js, tests/unit/web-inbox-keys.test.mjs keeps them
// equal), the check of a name and the example requests of the help.

/** Route that creates a key (signed in) and the route a key uses. */
export const INBOX_KEYS_ROUTE = '/api/byl/inbox/keys';
export const INBOX_INGEST_ROUTE = '/api/byl/inbox/ingest';

export const INBOX_KEY_NAME_MAX_LENGTH = 60;
export const INBOX_KEYS_MAX = 20;

/** Validation codes of the route, the same texts as the hook. */
export const INBOX_KEY_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_inbox_key_name: 'Bitte einen Namen mit 1 bis 60 Zeichen eingeben.',
	validation_inbox_key_limit: 'Höchstens 20 Zugangsschlüssel. Widerrufe zuerst einen alten.'
});

/** A key as the list shows it; the key itself is never part of it. */
export interface InboxKey {
	id: string;
	name: string;
	/** The first 8 characters, e.g. "byl_AbCd". */
	tokenHint: string;
	/** PocketBase timestamp of the creation. */
	created: string;
	/** PocketBase timestamp of the last use (at most once a minute), null for never. */
	lastUsedAt: string | null;
}

/** A new key with the key in plain text, shown once. */
export interface CreatedInboxKey extends InboxKey {
	token: string;
}

/** Why `name` cannot name a key, or null (the check of the hook, for the field). */
export function inboxKeyNameError(name: string): string | null {
	const value = name.replace(/\s+/g, ' ').trim();
	if (value === '' || value.length > INBOX_KEY_NAME_MAX_LENGTH) {
		return INBOX_KEY_MESSAGES.validation_inbox_key_name ?? null;
	}
	return null;
}

/** Placeholder of the key in the examples (CodeBlock, secret). */
export const KEY_PLACEHOLDER = 'schluessel';

/**
 * Example requests of the help and of a new key: PowerShell (Invoke-RestMethod, the text sent as
 * UTF-8 bytes, so umlauts arrive in Windows PowerShell 5.1 as well) and curl in the command prompt.
 * `origin` is the address of the app, e.g. http://127.0.0.1:8090; the key is the placeholder
 * {{schluessel}}.
 */
export function ingestExamples(origin: string): { powershell: string; curl: string } {
	const url = `${origin}${INBOX_INGEST_ROUTE}`;
	const powershell = [
		`$body = @{ mode = 'manual'; text = 'Milch kaufen'; external_id = 'einkauf-1' } | ConvertTo-Json`,
		`Invoke-RestMethod -Method Post -Uri '${url}' -Headers @{ Authorization = 'Bearer {{${KEY_PLACEHOLDER}}}' } -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))`
	].join('\n');
	const curl = `curl -X POST "${url}" -H "Authorization: Bearer {{${KEY_PLACEHOLDER}}}" -H "Content-Type: application/json" -d "{\\"mode\\": \\"manual\\", \\"text\\": \\"Milch kaufen\\", \\"external_id\\": \\"einkauf-1\\"}"`;
	return { powershell, curl };
}
