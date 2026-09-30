<script lang="ts">
	import { minuteClock } from '$lib/clock.svelte';
	import { connectionInfo } from '$lib/domain/channel-card';
	import { channelHealth, keywordSummary } from '$lib/domain/channel-health';
	import {
		CONNECTION_TYPE_LABELS,
		MAIL_INBOX_HINT,
		MAIL_PROVIDER_LABELS,
		lastResultText,
		mailHelperText,
		mailScanText,
		type Connection,
		type MailHelperStatus,
		type RunResult,
		type SecretStatus
	} from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { connectionAnchor } from '$lib/domain/sync-all';
	import { helpHref } from '$lib/settings-sections';
	import ChannelCard, { type CardAction } from './ChannelCard.svelte';

	// Card of a connection that fetches by itself: Google Calendar, Telegram and the mailboxes
	// Web.de and Gmail (ADR-0016, ADR-0020; since the plan kanal-karten KK-2 a configuration of the
	// building block ChannelCard). The state comes from channelHealth, the main button follows it:
	// "Jetzt abrufen", "Fortsetzen", "Einrichtung fortsetzen", during the full scan of an inbox
	// "Durchsuchen abbrechen", while a fetch runs "Wird abgerufen …". The menu "•••" holds the rest
	// (mailbox selection, keywords and switches, pausing, the scan, the setup, the help, deleting),
	// the details the former meta lines. The card carries the anchor `#verbindung-<id>`, the target
	// of "Zur Karte" in the flag of "Alle Kanäle jetzt abrufen".
	let {
		connection,
		secretStatus,
		running,
		helper = null,
		lastRun = null,
		message = null,
		onrun,
		onpick,
		onedit,
		onpause,
		ondelete,
		onsetup,
		onscan = () => undefined
	}: {
		connection: Connection;
		/** State of the variables; null while unknown. */
		secretStatus: SecretStatus | null;
		/** "Jetzt abrufen" is running. */
		running: boolean;
		/** Probe of the mail helper (mailboxes only); null while unknown. */
		helper?: MailHelperStatus | null;
		/** Answer of the last "Jetzt abrufen" on this page, or null. */
		lastRun?: RunResult | null;
		/** Error of the last action of this card (inline, ADR-0009). */
		message?: string | null;
		onrun: () => void;
		onpick: () => void;
		/** "Stichwörter und Einstellungen …": the edit modal of the owner. */
		onedit: () => void;
		/** Pauses (false) or resumes (true) the connection. */
		onpause: (enabled: boolean) => void;
		ondelete: () => void;
		/** Shows the setup of the kind of this connection. */
		onsetup: () => void;
		/** Mailbox: starts the full scan of the inbox again or cancels it. */
		onscan?: (action: 'start' | 'cancel') => void;
	} = $props();

	const clock = minuteClock();
	const mail = $derived(connection.type === 'mail');
	const scan = $derived(mail ? (connection.scan ?? null) : null);
	const scanning = $derived(scan?.state === 'running');
	const health = $derived(channelHealth(connection, secretStatus, running, mail ? helper : null));

	const kindLine = $derived(
		[
			mail ? 'Postfach' : CONNECTION_TYPE_LABELS[connection.type],
			mail && connection.mailProvider !== '' ? MAIL_PROVIDER_LABELS[connection.mailProvider] : null,
			mail && connection.mailUser !== '' ? connection.mailUser : null
		]
			.filter((part): part is string => part !== null)
			.join(' · ')
	);
	const info = $derived(connectionInfo(connection, lastRun, clock.now));
	const result = $derived(lastResultText(connection, lastRun));
	const lastRunText = $derived(
		connection.lastRunAt === null ? 'noch nie' : formatBerlinDateTime(connection.lastRunAt)
	);
	const lastOk = $derived(
		connection.lastOkAt !== null && connection.lastOkAt !== connection.lastRunAt
			? formatBerlinDateTime(connection.lastOkAt)
			: null
	);
	const icon = $derived(
		connection.type === 'calendar'
			? 'calendar'
			: connection.type === 'telegram'
				? 'telegram'
				: 'mail'
	);

	const run: CardAction = { label: 'Jetzt abrufen', onselect: () => onrun() };
	const cancelScan: CardAction = {
		label: 'Durchsuchen abbrechen',
		onselect: () => onscan('cancel')
	};

	/** The main button: what the state asks for first. */
	const primary = $derived.by((): CardAction => {
		if (health.action === 'none') return { label: 'Wird abgerufen …', busy: true };
		if (health.action === 'resume') return { label: 'Fortsetzen', onselect: () => onpause(true) };
		if (health.action === 'setup')
			return { label: 'Einrichtung fortsetzen', onselect: () => onsetup() };
		return scanning ? cancelScan : run;
	});

	/** Everything else, in a fixed order; the main button is not repeated. */
	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [];
		if (health.action === 'run' && primary !== run) entries.push(run);
		if (scanning && primary !== cancelScan) entries.push(cancelScan);
		if (health.pick) {
			entries.push({ label: 'Aus dem Postfach wählen …', dialog: true, onselect: () => onpick() });
		}
		entries.push({
			label: 'Stichwörter und Einstellungen …',
			dialog: true,
			onselect: () => onedit()
		});
		if (connection.enabled) entries.push({ label: 'Pausieren', onselect: () => onpause(false) });
		if (health.pick && connection.enabled) {
			entries.push({ label: 'Posteingang neu durchsuchen', onselect: () => onscan('start') });
		}
		if (health.action !== 'setup') {
			entries.push({ label: 'Einrichtung ansehen', onselect: () => onsetup() });
		}
		entries.push({ label: 'Hilfe', href: helpHref('zugangsdaten') });
		entries.push({ label: 'Löschen …', dialog: true, separated: true, onselect: () => ondelete() });
		return entries;
	});
</script>

<ChannelCard
	{icon}
	title={connection.label}
	subtitle={kindLine}
	status={health}
	{info}
	progress={scanning && scan !== null && scan.total > 0
		? { value: scan.done, max: scan.total }
		: null}
	hint={health.hint}
	{message}
	{primary}
	{menu}
	anchor={connectionAnchor(connection.id)}
>
	{#snippet details()}
		<dl>
			<div>
				<dt>Letzter Abruf</dt>
				<dd>
					{lastRunText}{#if lastOk !== null}, zuletzt erfolgreich {lastOk}{/if}
				</dd>
			</div>
			{#if result !== null}
				<div>
					<dt>Ergebnis</dt>
					<dd>{result}</dd>
				</div>
			{/if}
			<div>
				<dt>Stichwörter</dt>
				<dd>{keywordSummary(connection.keywords)}</dd>
			</div>
			{#if connection.type === 'telegram'}
				<div>
					<dt>Ohne Stichwort</dt>
					<dd>
						{connection.replyNoMatch
							? 'antwortet „Kein Stichwort erkannt – nicht gespeichert“'
							: 'antwortet nicht'}
					</dd>
				</div>
			{/if}
			{#if mail}
				<div>
					<dt>Durchsucht</dt>
					<dd>
						{connection.matchBody
							? 'Betreff, Absender, Kopfzeilen und Text'
							: 'Betreff und Absender'}
					</dd>
				</div>
				<div>
					<dt>Automatisch</dt>
					<dd>{MAIL_INBOX_HINT}</dd>
				</div>
				{#if scan !== null}
					<div>
						<dt>Posteingang</dt>
						<dd>{mailScanText(scan)}</dd>
					</div>
				{/if}
				<div>
					<dt>Hilfsprozess</dt>
					<dd>{mailHelperText(helper)}</dd>
				</div>
			{/if}
			{#if connection.lastError !== ''}
				<div>
					<dt>Letzter Fehler</dt>
					<dd>{connection.lastError}</dd>
				</div>
			{/if}
		</dl>
	{/snippet}
</ChannelCard>
