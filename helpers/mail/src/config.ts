// Configuration of the mail helper (ADR-0016 section 5, ADR-0018): everything comes from the
// command line and from BYL_* variables that byl-control.ps1 hands on. Pure; main.ts passes in
// process.argv and process.env.

/** Name of a variable with access data (ADR-0018 section 1), same as app/pb_hooks/lib/secrets.js. */
export const SECRET_NAME_PATTERN = /^BYL_[A-Z0-9_]{1,60}$/;

export const TOKEN_ENV = 'BYL_INGEST_TOKEN';
/** Test only: seconds between two runs instead of five minutes. */
export const INTERVAL_ENV = 'BYL_MAIL_INTERVAL_SECONDS';
/** Test only: a plain IMAP server on 127.0.0.1 with this port instead of the provider. */
export const TEST_IMAP_PORT_ENV = 'BYL_MAIL_TEST_IMAP_PORT';

export const DEFAULT_APP_URL = 'http://127.0.0.1:8090';
export const POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface ImapEndpoint {
	host: string;
	port: number;
	secure: boolean;
}

export interface HelperConfig {
	/** Base address of PocketBase, always http on 127.0.0.1. */
	appUrl: string;
	/** Token of the ingest routes (never logged). */
	token: string;
	intervalMs: number;
	/** Test only: IMAP server that replaces every provider. */
	imapOverride: ImapEndpoint | null;
}

export type Command =
	| { kind: 'version' }
	| { kind: 'self-test' }
	| { kind: 'help' }
	| { kind: 'run'; appUrl: string };

export const USAGE = [
	'byl-mail.exe – Mail-Hilfsprozess von becauseyoulovejira',
	'',
	'  byl-mail.exe run [--url=http://127.0.0.1:8090]   Postfächer alle 5 Minuten abrufen',
	'  byl-mail.exe --version                           Version ausgeben',
	'  byl-mail.exe --self-test                         Selbsttest ohne Netzwerk',
	'',
	'Gestartet und beendet wird der Prozess von start.bat, neu-starten.bat und stop.bat.'
].join('\n');

/** http://127.0.0.1:<port> without path; null for anything else. */
export function loopbackUrl(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null;
	if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
	if (url.pathname !== '/' && url.pathname !== '') return null;
	return `http://127.0.0.1:${url.port === '' ? '80' : url.port}`;
}

/** The command of the arguments (without executable and script), or an error text. */
export function parseCommand(args: readonly string[]): Command | { error: string } {
	const [first, ...rest] = args;
	if (first === '--version' || first === '-v') return { kind: 'version' };
	if (first === '--self-test') return { kind: 'self-test' };
	if (first === undefined || first === '--help' || first === '-h') return { kind: 'help' };
	if (first !== 'run') return { error: `Unbekannter Befehl: ${first}` };
	let appUrl = DEFAULT_APP_URL;
	for (const arg of rest) {
		if (!arg.startsWith('--url=')) return { error: `Unbekannte Option: ${arg}` };
		const url = loopbackUrl(arg.slice('--url='.length));
		if (url === null) return { error: 'Die Adresse muss http://127.0.0.1:<Port> sein.' };
		appUrl = url;
	}
	return { kind: 'run', appUrl };
}

/** The value of a BYL_* variable, trimmed; '' for an invalid name or an unset variable. */
export function readSecret(name: string, env: NodeJS.ProcessEnv): string {
	if (!SECRET_NAME_PATTERN.test(name)) return '';
	return (env[name] ?? '').trim();
}

/** Configuration of "run", or an error text (for example without token). */
export function readConfig(appUrl: string, env: NodeJS.ProcessEnv): HelperConfig | { error: string } {
	const token = readSecret(TOKEN_ENV, env);
	if (token === '') {
		return {
			error: `${TOKEN_ENV} fehlt. start.bat legt die Variable an, sobald byl-mail.exe im Ordner app liegt.`
		};
	}
	let intervalMs = POLL_INTERVAL_MS;
	const interval = (env[INTERVAL_ENV] ?? '').trim();
	if (interval !== '') {
		const seconds = Number(interval);
		if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
			return { error: `${INTERVAL_ENV} muss eine ganze Zahl von 1 bis 3600 sein.` };
		}
		intervalMs = seconds * 1000;
	}
	let imapOverride: ImapEndpoint | null = null;
	const port = (env[TEST_IMAP_PORT_ENV] ?? '').trim();
	if (port !== '') {
		const value = Number(port);
		if (!Number.isInteger(value) || value < 1 || value > 65535) {
			return { error: `${TEST_IMAP_PORT_ENV} muss ein Port sein.` };
		}
		imapOverride = { host: '127.0.0.1', port: value, secure: false };
	}
	return { appUrl, token, intervalMs, imapOverride };
}
