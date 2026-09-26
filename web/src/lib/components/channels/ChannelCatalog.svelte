<script lang="ts" module>
	/** Entries of the catalog "Kanal hinzufügen" (plan §3.4); the IDs are those of the assistant (EH-5). */
	export type CatalogEntry = 'kalender' | 'telegram' | 'webde' | 'gmail' | 'proton';
</script>

<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Connection } from '$lib/domain/connections';
	import Lozenge from '../guidance/Lozenge.svelte';
	import ChannelIcon, { type ChannelIconKind } from './ChannelIcon.svelte';

	// Catalog "Kanal hinzufügen" (ADR-0026 section 3, plan EH-3 and §3.4): one tile per service with
	// symbol, name, one sentence and "Einrichten". While there is no connection of a kind, the tile
	// says "Nicht eingerichtet"; several connections of a kind are allowed, so the tile stays and then
	// offers "Weitere einrichten". Proton has no automatic fetch in the free plan and leads to its
	// guide. The heading is the target of "Kanal hinzufügen" in the empty state. A service with a
	// setup assistant (EH-5 on) has a link to it (?einrichten=<art>), so a middle click works too;
	// it replaces the history entry, like closing the assistant does.
	let {
		connections,
		heading = $bindable(),
		hrefOf = () => null,
		onsetup
	}: {
		connections: readonly Connection[];
		/** The heading "Kanal hinzufügen"; the empty state moves the focus to it. */
		heading?: HTMLElement;
		/** Address of the assistant of a service; null keeps the button of `onsetup`. */
		hrefOf?: (entry: CatalogEntry) => ResolvedPathname | null;
		onsetup: (entry: CatalogEntry) => void;
	} = $props();

	const uid = $props.id();

	const ENTRIES: readonly {
		id: CatalogEntry;
		name: string;
		text: string;
		icon: ChannelIconKind;
		exists: (connection: Connection) => boolean;
	}[] = [
		{
			id: 'kalender',
			name: 'Google Calendar',
			text: 'Termine mit Stichwort alle 15 Minuten.',
			icon: 'calendar',
			exists: (connection) => connection.type === 'calendar'
		},
		{
			id: 'telegram',
			name: 'Telegram-Bot',
			text: 'Nachrichten an deinen Bot, jede Minute.',
			icon: 'telegram',
			exists: (connection) => connection.type === 'telegram'
		},
		{
			id: 'webde',
			name: 'Web.de',
			text: 'Mails mit Stichwort im Betreff, alle 5 Minuten.',
			icon: 'mail',
			exists: (connection) => connection.type === 'mail' && connection.mailProvider === 'webde'
		},
		{
			id: 'gmail',
			name: 'Gmail',
			text: 'Mails mit Stichwort im Betreff, alle 5 Minuten.',
			icon: 'mail',
			exists: (connection) => connection.type === 'mail' && connection.mailProvider === 'gmail'
		}
	];
</script>

<section class="catalog" aria-labelledby={`${uid}-heading`}>
	<h3 id={`${uid}-heading`} tabindex="-1" bind:this={heading}>Kanal hinzufügen</h3>
	<ul class="tiles">
		{#each ENTRIES as entry (entry.id)}
			{@const exists = connections.some(entry.exists)}
			{@const href = hrefOf(entry.id)}
			<li class="tile">
				<div class="head">
					<ChannelIcon kind={entry.icon} />
					<h4>{entry.name}</h4>
				</div>
				<p>{entry.text}</p>
				<div class="foot">
					{#if !exists}
						<Lozenge label="Nicht eingerichtet" icon="pending" />
					{/if}
					{#if href !== null}
						<a
							class="button-secondary setup"
							{href}
							data-sveltekit-keepfocus
							data-sveltekit-noscroll
							data-sveltekit-replacestate
						>
							{exists ? 'Weitere einrichten' : 'Einrichten'}<span class="visually-hidden"
								>: {entry.name}</span
							>
						</a>
					{:else}
						<button class="button-secondary" type="button" onclick={() => onsetup(entry.id)}>
							{exists ? 'Weitere einrichten' : 'Einrichten'}<span class="visually-hidden"
								>: {entry.name}</span
							>
						</button>
					{/if}
				</div>
			</li>
		{/each}
		<li class="tile">
			<div class="head">
				<ChannelIcon kind="proton" />
				<h4>Proton Mail</h4>
			</div>
			<p>Kein automatischer Abruf im Free-Tarif: Mails als Datei exportieren.</p>
			<div class="foot">
				<Lozenge label="Per Datei" icon="file" tone="muted" />
				<button class="button-secondary" type="button" onclick={() => onsetup('proton')}>
					Anleitung<span class="visually-hidden">: Proton Mail</span>
				</button>
			</div>
		</li>
	</ul>
</section>

<style>
	.catalog {
		display: grid;
		gap: 0.75rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	h3:focus {
		outline: none;
	}

	h3:focus-visible {
		outline: 2px solid var(--color-brand);
		outline-offset: 2px;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 0.75rem;
		list-style: none;
	}

	.tile {
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.625rem;
		align-items: center;
	}

	h4 {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	p {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.setup {
		text-decoration: none;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}
</style>
