// Entry of byl-mail.exe (ADR-0016 sections 4 and 5; E4 plan package 11). byl-control.ps1 starts it
// with "run" next to PocketBase and stop.bat ends it; it fetches the mail connections every five
// minutes and waits quietly while there are none. Next to it runs the local interface of the mailbox
// selection (server.ts, package 23) on 127.0.0.1. "--version" and "--self-test" run without
// network, so the build can check the executable on a machine without Node.

import { ImapFlow } from 'imapflow';
import { parseCommand, readConfig, TOKEN_ENV, USAGE, type HelperConfig } from './config';
import { IngestClient } from './ingest-client';
import { createLogger, errorText, type Logger } from './log';
import { ingestDraft, keywordOf, parseMail } from './mail';
import { pollAll } from './poll';
import { PROVIDERS } from './providers';
import { startMailboxServer } from './server';

declare const __BYL_MAIL_VERSION__: string | undefined;

/** Version of the helper; set by the build (esbuild define), "dev" when run from source. */
export const VERSION = typeof __BYL_MAIL_VERSION__ === 'string' ? __BYL_MAIL_VERSION__ : 'dev';

// Invented mail for the self-test: quoted-printable, umlauts, a keyword in the subject.
const SELF_TEST_MAIL = [
	'From: Anna Beispiel <anna@example.com>',
	'To: bert@example.com',
	'Subject: =?UTF-8?Q?Todo:_Steuererkl=C3=A4rung?=',
	'Message-ID: <selbsttest@byl.invalid>',
	'Date: Fri, 25 Sep 2026 10:00:00 +0200',
	'MIME-Version: 1.0',
	'Content-Type: text/plain; charset=UTF-8',
	'Content-Transfer-Encoding: quoted-printable',
	'',
	'Bitte bis Freitag pr=C3=BCfen.',
	''
].join('\r\n');

/** Checks parser, keywords, providers and the IMAP library without network. */
export async function selfTest(): Promise<{ ok: boolean; checks: Record<string, boolean> }> {
	const draft = await parseMail(new TextEncoder().encode(SELF_TEST_MAIL));
	const payload = ingestDraft(draft, 'selbsttest00000', 'auto');
	const checks = {
		parser: draft.title === 'Todo: Steuererklärung' && draft.body === 'Bitte bis Freitag prüfen.',
		messageId: payload.source_ref === '<selbsttest@byl.invalid>',
		keywords: keywordOf(draft, ['rechnung', 'todo'], false) === 'todo' && keywordOf(draft, ['prufen'], true) === 'prufen',
		providers: PROVIDERS.webde?.host === 'imap.web.de' && PROVIDERS.webde.port === 993,
		imap: typeof ImapFlow === 'function',
		fetch: typeof fetch === 'function' && typeof FormData === 'function'
	};
	return { ok: Object.values(checks).every(Boolean), checks };
}

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener('abort', () => {
			clearTimeout(timer);
			resolve();
		}, { once: true });
	});

/** Runs until `signal` aborts: one run over all connections, then the interval. */
export async function runLoop(config: HelperConfig, log: Logger, signal: AbortSignal): Promise<void> {
	const ingest = new IngestClient(config.appUrl, config.token);
	const server = await startMailboxServer({
		token: config.token,
		ingest,
		env: process.env,
		log,
		imapOverride: config.imapOverride
	});
	signal.addEventListener('abort', () => server?.close(), { once: true });
	log.info(`byl-mail ${VERSION} gestartet (PocketBase ${config.appUrl}, Abruf alle ${Math.round(config.intervalMs / 1000)} s).`);
	while (!signal.aborted) {
		try {
			await pollAll({
				ingest,
				env: process.env,
				log,
				imapOverride: config.imapOverride,
				secrets: [config.token]
			});
		} catch (error) {
			log.error(`Unerwarteter Fehler im Abruf: ${errorText(error)}`);
		}
		await sleep(config.intervalMs, signal);
	}
	log.info('byl-mail beendet.');
}

export async function main(args: readonly string[]): Promise<number> {
	const command = parseCommand(args);
	if ('error' in command) {
		process.stderr.write(`${command.error}\n\n${USAGE}\n`);
		return 2;
	}
	switch (command.kind) {
		case 'version':
			process.stdout.write(`byl-mail ${VERSION}\n`);
			return 0;
		case 'help':
			process.stdout.write(`${USAGE}\n`);
			return 0;
		case 'self-test': {
			const result = await selfTest();
			process.stdout.write(`${JSON.stringify({ ...result, version: VERSION, node: process.version })}\n`);
			return result.ok ? 0 : 1;
		}
		case 'run': {
			const log = createLogger(
				(line) => process.stdout.write(line),
				() => [process.env[TOKEN_ENV] ?? '']
			);
			const config = readConfig(command.appUrl, process.env);
			if ('error' in config) {
				log.error(config.error);
				return 1;
			}
			const controller = new AbortController();
			for (const name of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
				process.once(name, () => controller.abort());
			}
			await runLoop(config, log, controller.signal);
			return 0;
		}
	}
}
