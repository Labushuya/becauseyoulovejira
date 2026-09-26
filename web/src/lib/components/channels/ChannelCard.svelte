<script lang="ts">
	import { channelHealth, keywordSummary } from '$lib/domain/channel-health';
	import {
		CONNECTION_TYPE_LABELS,
		MAIL_PROVIDER_LABELS,
		type Connection,
		type SecretStatus
	} from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import Lozenge from '../guidance/Lozenge.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Popover from '../overlay/Popover.svelte';
	import ChannelIcon from './ChannelIcon.svelte';

	// Card of a connection (ADR-0026 section 3, plan EH-3 and §3.5): symbol, name, kind line, state
	// as lozenge (channelHealth), at most two lines of meta, at most one compact hint and the
	// actions. The main action follows the state ("Jetzt abrufen", "Aus dem Postfach wählen",
	// "Fortsetzen", "Einrichtung fortsetzen"); "Bearbeiten" opens the modal of its owner, and the menu
	// "…" holds pausing, the setup and deleting. Every action names the connection for screen readers.
	let {
		connection,
		secretStatus,
		running,
		message = null,
		onrun,
		onpick,
		onedit,
		onpause,
		ondelete,
		onsetup
	}: {
		connection: Connection;
		/** State of the variables; null while unknown. */
		secretStatus: SecretStatus | null;
		/** "Jetzt abrufen" is running. */
		running: boolean;
		/** Error of the last action of this card (inline, ADR-0009). */
		message?: string | null;
		onrun: () => void;
		onpick: () => void;
		onedit: () => void;
		/** Pauses (false) or resumes (true) the connection. */
		onpause: (enabled: boolean) => void;
		ondelete: () => void;
		/** Shows the setup of the kind of this connection. */
		onsetup: () => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-name`;

	const health = $derived(channelHealth(connection, secretStatus, running));
	const kindLine = $derived(
		[
			connection.type === 'mail' ? 'Postfach' : CONNECTION_TYPE_LABELS[connection.type],
			connection.type === 'mail' && connection.mailProvider !== ''
				? MAIL_PROVIDER_LABELS[connection.mailProvider]
				: null,
			connection.type === 'mail' && connection.mailUser !== '' ? connection.mailUser : null
		]
			.filter((part): part is string => part !== null)
			.join(' · ')
	);
	const lastRun = $derived(
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
</script>

<article class="channel-card" aria-labelledby={headingId} data-state={health.state}>
	<header class="head">
		<ChannelIcon kind={icon} />
		<div class="names">
			<h4 id={headingId}>{connection.label}</h4>
			<p class="kind">{kindLine}</p>
		</div>
		<Lozenge label={health.label} icon={health.icon} tone={health.tone} />
	</header>

	<dl class="meta">
		<div>
			<dt>Letzter Abruf</dt>
			<dd>
				{lastRun}{#if lastOk !== null}<span class="ok">, zuletzt erfolgreich {lastOk}</span>{/if}
			</dd>
		</div>
		<div>
			<dt>Stichwörter</dt>
			<dd>{keywordSummary(connection.keywords)}</dd>
		</div>
	</dl>

	{#if health.hint !== null}
		<SectionMessage tone={health.hint.tone} compact>{health.hint.text}</SectionMessage>
	{/if}
	{#if message !== null}
		<SectionMessage tone="error" compact live>{message}</SectionMessage>
	{/if}

	<footer class="actions">
		{#if health.action === 'pick'}
			<button class="button-secondary" type="button" onclick={onpick}>
				Aus dem Postfach wählen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else if health.action === 'resume'}
			<button class="button-secondary" type="button" onclick={() => onpause(true)}>
				Fortsetzen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else if health.action === 'setup'}
			<button class="button-secondary" type="button" onclick={onsetup}>
				Einrichtung fortsetzen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else if health.action === 'run'}
			<button class="button-secondary" type="button" onclick={onrun}>
				Jetzt abrufen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else}
			<button class="button-secondary" type="button" aria-disabled="true" aria-busy="true">
				Wird abgerufen …<span class="visually-hidden">: {connection.label}</span>
			</button>
		{/if}
		<button class="button-secondary" type="button" aria-haspopup="dialog" onclick={onedit}>
			Bearbeiten<span class="visually-hidden">: {connection.label}</span>
		</button>
		<span class="more">
			<Popover
				kind="menu"
				label={`Weitere Aktionen für ${connection.label}`}
				placement="bottom-end"
				buttonClass="button-icon"
				buttonLabel={`Weitere Aktionen für ${connection.label}`}
			>
				{#snippet button()}
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
						<circle cx="3.5" cy="8" r="1.1" />
						<circle cx="8" cy="8" r="1.1" />
						<circle cx="12.5" cy="8" r="1.1" />
					</svg>
				{/snippet}
				{#snippet children({ close })}
					<button
						class="item"
						type="button"
						role="menuitem"
						tabindex="-1"
						onclick={() => {
							close();
							onpause(!connection.enabled);
						}}
					>
						{connection.enabled ? 'Pausieren' : 'Fortsetzen'}
					</button>
					<button
						class="item"
						type="button"
						role="menuitem"
						tabindex="-1"
						onclick={() => {
							close();
							onsetup();
						}}
					>
						Einrichtung ansehen
					</button>
					<div class="separator" role="separator"></div>
					<button
						class="item"
						type="button"
						role="menuitem"
						tabindex="-1"
						aria-haspopup="dialog"
						onclick={() => {
							close();
							ondelete();
						}}
					>
						Löschen …
					</button>
				{/snippet}
			</Popover>
		</span>
	</footer>
</article>

<style>
	.channel-card {
		display: grid;
		grid-template-rows: auto auto auto 1fr;
		gap: 0.75rem;
		min-width: 0;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.names {
		flex: 1;
		min-width: 0;
	}

	h4 {
		font-size: 0.9375rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.kind {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.meta {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8125rem;
	}

	.meta div {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		overflow-wrap: anywhere;
	}

	.ok {
		color: var(--color-text-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: flex-end;
		align-self: end;
	}

	.more {
		display: inline-flex;
		margin-left: auto;
	}

	.more svg {
		fill: currentColor;
	}

	.item {
		display: flex;
		width: 100%;
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		text-align: left;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.item:hover,
	.item:focus-visible {
		background: var(--color-bg);
	}

	.separator {
		height: 1px;
		margin: 0.25rem 0;
		background: var(--color-line);
	}
</style>
