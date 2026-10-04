<script lang="ts" module>
	/** Entries of the catalog "Kanal hinzufügen" (plan §3.4); the IDs are those of the assistant (EH-5). */
	export type CatalogEntry =
		| 'kalender'
		| 'telegram'
		| 'webde'
		| 'gmail'
		| 'github'
		| 'ordner'
		| 'notion'
		| 'proton'
		| 'whatsapp-web';
</script>

<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { AREA_TEXTS } from '$lib/domain/area';
	import type { Connection } from '$lib/domain/connections';
	import { helpHref } from '$lib/settings-sections';
	import Lozenge from '../guidance/Lozenge.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ChannelIcon, { type ChannelIconKind } from './ChannelIcon.svelte';

	// Catalog "Kanal hinzufügen" (ADR-0026 section 3, plan EH-3 and §3.4): one tile per service with
	// symbol, name, one sentence and "Einrichten". While there is no connection of a kind, the tile
	// says "Nicht eingerichtet"; several connections of a kind are allowed, so the tile stays and then
	// offers "Weitere einrichten". Proton has no automatic fetch in the free plan and leads to its
	// guide. The heading is the target of "Kanal hinzufügen" in the empty state. Every tile links to
	// its assistant or guide (?einrichten=<art>, EH-5 to EH-7), so a middle click works too; the link
	// replaces the history entry, like closing the assistant does. Notion (ADR-0041) fetches nothing
	// by itself; its tile says "Import". GitHub (ADR-0050) watches repositories like the services
	// above, read only, and so do the folders of this machine (ADR-0051). Channels with access data
	// of this machine and folders are set up only by the administrator of the app (ADR-0056 §5): for
	// another account the catalog says so and keeps the two tiles it can use (Proton per file,
	// WhatsApp Web with its own key). In the household area (E7-3, ADR-0059 §5) no connection is set
	// up: every service and WhatsApp Web (its key belongs to the account, its entries are private)
	// says "Nur im privaten Bereich" instead of "Einrichten"; Proton per file stays.
	let {
		connections,
		heading = $bindable(),
		hrefOf,
		admin = true,
		household = false
	}: {
		connections: readonly Connection[];
		/** The heading "Kanal hinzufügen"; the empty state moves the focus to it. */
		heading?: HTMLElement;
		/** Address of the assistant or guide of a service. */
		hrefOf: (entry: CatalogEntry) => ResolvedPathname;
		/** The signed-in account is the administrator of the app. */
		admin?: boolean;
		/** The tab shows the household area: no connection is offered. */
		household?: boolean;
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
		},
		{
			id: 'github',
			name: 'GitHub',
			text: 'Roadmaps, Changelogs, Pull Requests und Releases deiner Repositorys, nur lesend, alle 15 Minuten.',
			icon: 'github',
			exists: (connection) => connection.type === 'github'
		},
		{
			id: 'ordner',
			name: 'Ordner',
			text: 'Neue und geänderte Dateien in Ordnern dieses Rechners, nur lesend, alle 5 Minuten.',
			icon: 'folder',
			exists: (connection) => connection.type === 'folder'
		}
	];
</script>

<section class="catalog" aria-labelledby={`${uid}-heading`} data-tour="channel-catalog">
	<h3 id={`${uid}-heading`} tabindex="-1" bind:this={heading}>Kanal hinzufügen</h3>
	{#if household}
		<SectionMessage tone="info" title="Verbindungen gibt es nur im privaten Bereich">
			<p>{AREA_TEXTS.privateOnlyText}</p>
			<p>
				Im Haushalt gehen Schnellerfassung und Zwischenablage, das Bookmarklet und Datei-Importe
				(Mail- und Kalenderdateien, WhatsApp-Exporte, auch Proton per Datei); ihre Einträge landen
				im Eingang des Haushalts.
				<a href={helpHref('bereiche')}>Mehr zu den Bereichen</a>
			</p>
		</SectionMessage>
	{:else if !admin}
		<SectionMessage tone="info" title="Kanäle mit Zugangsdaten richtet der Verwalter ein">
			<p>
				Google Calendar, Telegram, Postfächer, Notion, GitHub und Ordner lesen Zugangsdaten oder
				Ordner dieses Rechners. Einrichten darf sie deshalb nur der Verwalter der App.
			</p>
			<p>
				Du kannst selbst nutzen: Schnellerfassung und Zwischenablage, das Bookmarklet, Datei-Importe
				(Mail- und Kalenderdateien, WhatsApp-Exporte, auch Proton per Datei), den eigenen Eingang
				mit deinem eigenen Zugangsschlüssel und damit WhatsApp Web.
				<a href={helpHref('konten')}>Was darf welches Konto?</a>
			</p>
		</SectionMessage>
	{/if}
	<ul class="tiles">
		{#each admin ? ENTRIES : [] as entry (entry.id)}
			{@const exists = connections.some(entry.exists)}
			<li class="tile">
				<div class="head">
					<ChannelIcon kind={entry.icon} />
					<h4>{entry.name}</h4>
				</div>
				<p>{entry.text}</p>
				<div class="foot">
					{#if household}
						<Lozenge label={AREA_TEXTS.privateOnly} icon="info" tone="muted" />
					{:else}
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
		{#if admin}
			<li class="tile">
				<div class="head">
					<ChannelIcon kind="notion" />
					<h4>Notion (Listen übernehmen)</h4>
				</div>
				<p>Bestehende Listen und Datenbanken als Kopien übernehmen, nur lesend, nur auf Anstoß.</p>
				<div class="foot">
					{#if household}
						<Lozenge label={AREA_TEXTS.privateOnly} icon="info" tone="muted" />
					{:else}
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
					{/if}
				</div>
			</li>
		{/if}
		<li class="tile">
			<div class="head">
				<ChannelIcon kind="whatsapp-web" />
				<h4>WhatsApp Web</h4>
			</div>
			<p>Browser-Erweiterung: Nachrichten aus dem offenen Tab, liest nur.</p>
			<div class="foot">
				{#if household}
					<Lozenge label={AREA_TEXTS.privateOnly} icon="info" tone="muted" />
				{:else}
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
				{/if}
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
