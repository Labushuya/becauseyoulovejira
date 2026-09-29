<script lang="ts" module>
	/** Entries of the catalog "Kanal hinzufügen" (plan §3.4); the IDs are those of the assistant (EH-5). */
	export type CatalogEntry =
		'kalender' | 'telegram' | 'webde' | 'gmail' | 'notion' | 'proton' | 'whatsapp-web';
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
	// guide. The heading is the target of "Kanal hinzufügen" in the empty state. Every tile links to
	// its assistant or guide (?einrichten=<art>, EH-5 to EH-7), so a middle click works too; the link
	// replaces the history entry, like closing the assistant does. Notion (ADR-0041) fetches nothing
	// by itself; its tile says "Import".
	let {
		connections,
		heading = $bindable(),
		hrefOf
	}: {
		connections: readonly Connection[];
		/** The heading "Kanal hinzufügen"; the empty state moves the focus to it. */
		heading?: HTMLElement;
		/** Address of the assistant or guide of a service. */
		hrefOf: (entry: CatalogEntry) => ResolvedPathname;
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
			text: 'Mails mit Stichwort in Betreff oder Absender, alle 5 Minuten.',
			icon: 'mail',
			exists: (connection) => connection.type === 'mail' && connection.mailProvider === 'webde'
		},
		{
			id: 'gmail',
			name: 'Gmail',
			text: 'Mails mit Stichwort in Betreff oder Absender, alle 5 Minuten.',
			icon: 'mail',
			exists: (connection) => connection.type === 'mail' && connection.mailProvider === 'gmail'
		}
	];
</script>

<section class="catalog" aria-labelledby={`${uid}-heading`} data-tour="channel-catalog">
	<h3 id={`${uid}-heading`} tabindex="-1" bind:this={heading}>Kanal hinzufügen</h3>
	<ul class="tiles">
		{#each ENTRIES as entry (entry.id)}
			{@const exists = connections.some(entry.exists)}
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
					<a
						class="button-secondary setup"
						href={hrefOf(entry.id)}
						data-sveltekit-keepfocus
						data-sveltekit-noscroll
						data-sveltekit-replacestate
					>
						{exists ? 'Weitere einrichten' : 'Einrichten'}<span class="visually-hidden"
							>: {entry.name}</span
						>
					</a>
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
				<a
					class="button-secondary setup"
					href={hrefOf('proton')}
					data-sveltekit-keepfocus
					data-sveltekit-noscroll
					data-sveltekit-replacestate
				>
					Anleitung<span class="visually-hidden">: Proton Mail</span>
				</a>
			</div>
		</li>
		<li class="tile">
			<div class="head">
				<ChannelIcon kind="notion" />
				<h4>Notion (Listen übernehmen)</h4>
			</div>
			<p>Bestehende Listen und Datenbanken als Kopien übernehmen, nur lesend, nur auf Anstoß.</p>
			<div class="foot">
				<Lozenge label="Import" icon="inbox" tone="muted" />
				<a
					class="button-secondary setup"
					href={hrefOf('notion')}
					data-sveltekit-keepfocus
					data-sveltekit-noscroll
					data-sveltekit-replacestate
				>
					{connections.some((connection) => connection.type === 'notion')
						? 'Weitere einrichten'
						: 'Einrichten'}<span class="visually-hidden">: Notion</span>
				</a>
			</div>
		</li>
		<li class="tile">
			<div class="head">
				<ChannelIcon kind="whatsapp-web" />
				<h4>WhatsApp Web</h4>
			</div>
			<p>Browser-Erweiterung: Nachrichten aus dem offenen Tab, liest nur.</p>
			<div class="foot">
				<Lozenge label="Erweiterung" icon="info" tone="muted" />
				<a
					class="button-secondary setup"
					href={hrefOf('whatsapp-web')}
					data-sveltekit-keepfocus
					data-sveltekit-noscroll
					data-sveltekit-replacestate
				>
					Einrichten<span class="visually-hidden">: WhatsApp Web</span>
				</a>
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
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
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
