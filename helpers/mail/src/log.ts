// Log of the mail helper (ADR-0016 section 5): one line per event on standard output, which
// byl-control.ps1 writes to app\logs\byl-mail.log. Callers pass only counts, IDs, labels and
// cleaned error texts, never access data or contents of mails; `redact` removes known secrets
// once more before a text is written or reported.

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

const REPLACEMENT = '***';
// Shorter values would hit ordinary words (same limit as app/pb_hooks/lib/secrets.js).
const MIN_SECRET_LENGTH = 4;
const MAX_LENGTH = 1000;

/** `text` with every secret (also URL-encoded) replaced by ***, cut to 1 000 characters. */
export function redact(text: string, secrets: readonly string[]): string {
	let result = text;
	for (const secret of secrets) {
		if (secret.length < MIN_SECRET_LENGTH) continue;
		for (const variant of new Set([secret, encodeURIComponent(secret)])) {
			result = result.split(variant).join(REPLACEMENT);
		}
	}
	return result.length > MAX_LENGTH ? `${result.slice(0, MAX_LENGTH - 1)}…` : result;
}

/** Text of an unknown error, without stack. */
export function errorText(error: unknown): string {
	if (error instanceof Error) {
		const code = (error as Error & { code?: unknown }).code;
		return typeof code === 'string' && !error.message.includes(code)
			? `${error.message} (${code})`
			: error.message;
	}
	return String(error);
}

/**
 * Logger that writes lines "2026-09-25T10:00:00.000Z INFO text"; `secrets` returns the values that
 * must never appear (token, passwords) at the moment of writing.
 */
export function createLogger(
	write: (line: string) => void,
	secrets: () => readonly string[] = () => [],
	now: () => Date = () => new Date()
): Logger {
	const line = (level: LogLevel, message: string) =>
		write(
			`${now().toISOString()} ${level} ${redact(message, secrets()).replace(/[\r\n]+/g, ' ')}\n`
		);
	return {
		info: (message) => line('INFO', message),
		warn: (message) => line('WARN', message),
		error: (message) => line('ERROR', message)
	};
}
