<script lang="ts">
	import { resolve } from '$app/paths';
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import { formatCalendarDate } from '$lib/domain/format';
	import type { HostPlatform } from '$lib/domain/host-platform';
	import {
		ACTION_TEXTS,
		DATABASE_GROUPS,
		DATABASE_GROUP_LABELS,
		FILE_CATEGORIES,
		FILE_CATEGORY_LABELS,
		LEFTOVER_GROUPS,
		LEFTOVER_LABELS,
		PARTIAL_NOTICE,
		belongsText,
		boundToTrashText,
		bytesText,
		countText,
		databaseText,
		previewText,
		summaryText,
		type FileCategory,
		type LeftoverGroup,
		type StorageAction
	} from '$lib/domain/storage';
	import { formatPointInTime } from '$lib/domain/system';
	import { helpHref } from '$lib/settings-sections';
	import type { StorageStore } from '$lib/stores/storage.svelte';
	import { inboxItemHref, trashHref } from '$lib/ticket-links';

	// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9): what the app takes, measured when the page
	// opens (no counting in the background): the databases with their free part and groups, the
	// original files of the inbox by where they belong, the largest of them with their ticket, the
	// backups here and in the target folder, safety copies, logs, program files and the free space.
	// Three actions, each with what it touches and a question first (no red, ADR-0009): compact the
	// databases, clear what was left behind (old automatic backups of PocketBase only when chosen),
	// empty discarded entries early. Original files at sources are never deleted one by one; tickets
	// go through the trash, which deletes for good only without dependencies (ADR-0047 §1).
	let { store, platform }: { store: StorageStore; platform: HostPlatform } = $props();

	const uid = $props.id();
	const overview = $derived(store.overview);
	const busy = $derived(store.busy !== null);
	let groups = $state<LeftoverGroup[]>(['programs', 'safety']);
	let asking = $state<StorageAction | null>(null);

	const freeInDatabases = $derived(
		overview === null
			? 0
			: (overview.database.freeBytes ?? 0) + (overview.logsDatabase.freeBytes ?? 0)
	);
	const chosenLeftovers = $derived(
		overview === null ? [] : groups.map((group) => overview.actions.leftovers[group])
	);
	const targetText = $derived.by(() => {
		const target = overview?.backups.target ?? null;
		if (target === null) return 'Kein Zielverzeichnis eingestellt';
		return target === 'unreachable' ? 'Gerade nicht erreichbar' : summaryText(target);
	});
	const boundText = $derived(
		overview === null ? '' : boundToTrashText(overview.files.categories.trash)
	);
	const webText = $derived.by(() => {
		const web = overview?.program?.web;
		if (web === undefined) return '';
		const size = `${web.complete ? '' : 'mindestens '}${bytesText(web.bytes)}`;
		return web.builds === null ? size : `${size}, Dateien der letzten ${web.builds} Builds`;
	});

	/** A category of the files, the discarded ones with the day the next is emptied. */
	function categoryText(category: FileCategory): string {
		if (overview === null) return '';
		const counted = countText(overview.files.categories[category]);
		const next = overview.files.nextEmpty;
		return category === 'discarded' && next !== null
			? `${counted}; die App leert den nächsten ab ${formatCalendarDate(next)}`
			: counted;
	}

	function toggle(group: LeftoverGroup, on: boolean) {
		groups = on
			? LEFTOVER_GROUPS.filter((entry) => entry === group || groups.includes(entry))
			: groups.filter((entry) => entry !== group);
	}

	async function confirmed() {
		const action = asking;
		asking = null;
		if (action !== null) await store.run(action, action === 'leftovers' ? groups : []);
	}

	function askLabel(action: StorageAction): string {
		return `${ACTION_TEXTS[action].title} …`;
	}
</script>

{#if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Speicher wird gemessen …</p>
{:else if overview === null}
	{#if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.load()}>
					Erneut messen
				</button>
			{/snippet}
		</SectionMessage>
	{/if}
{:else}
	<p class="intro">
		Was becauseyoulovejira auf diesem Rechner belegt, gemessen {formatPointInTime(
			overview.measuredAt
		)}. Mehr dazu in der <a href={helpHref('speicher')}>Hilfe unter „Speicher“</a>.
	</p>
	<div class="action">
		<button
			class="button-secondary"
			type="button"
			aria-disabled={busy}
			onclick={() => {
				if (!busy) void store.load();
			}}
		>
			Neu messen
		</button>
	</div>
	{#if !overview.ownInstance}
		<SectionMessage tone="info" title={PARTIAL_NOTICE.title}>{PARTIAL_NOTICE.text}</SectionMessage>
	{/if}

	<section class="part" aria-labelledby={`${uid}-database`}>
		<h3 id={`${uid}-database`}>Datenbank</h3>
		<dl class="rows">
			<div class="row">
				<dt>Daten (data.db)</dt>
				<dd>{databaseText(overview.database)}</dd>
			</div>
			{#if overview.database.groups !== null}
				{#each DATABASE_GROUPS as group (group)}
					<div class="row sub">
						<dt>{DATABASE_GROUP_LABELS[group]}</dt>
						<dd>{bytesText(overview.database.groups[group])}</dd>
					</div>
				{/each}
			{/if}
			{#if overview.database.trash !== null}
				{@const trash = overview.database.trash}
				<div class="row sub">
					<dt>Papierkorb</dt>
					<dd>
						{trash.tickets === 1 ? '1 Ticket' : `${trash.tickets} Tickets`}, etwa {bytesText(
							trash.bytes
						)} Text{#if trash.blocked > 0}, davon {trash.blocked} blockiert{/if}.
						<a href={trashHref()}>Papierkorb öffnen</a>
					</dd>
				</div>
			{/if}
			<div class="row">
				<dt>Logs (auxiliary.db)</dt>
				<dd>{databaseText(overview.logsDatabase)}</dd>
			</div>
		</dl>
	</section>

	<section class="part" aria-labelledby={`${uid}-files`}>
		<h3 id={`${uid}-files`}>Dateien im Eingang</h3>
		<dl class="rows">
			<div class="row">
				<dt>Zusammen</dt>
				<dd>{countText(overview.files.total)}</dd>
			</div>
			{#each FILE_CATEGORIES as category (category)}
				{@const entry = overview.files.categories[category]}
				{#if entry.count > 0 || category !== 'other'}
					<div class="row sub">
						<dt>{FILE_CATEGORY_LABELS[category]}</dt>
						<dd>{categoryText(category)}</dd>
					</div>
				{/if}
			{/each}
			{#if overview.files.copies.count > 0}
				<div class="row sub">
					<dt>Davon Kopien aus „Duplizieren“</dt>
					<dd>{countText(overview.files.copies)}</dd>
				</div>
			{/if}
		</dl>
		<p class="hint">
			Originaldateien an Quellen lassen sich nicht einzeln löschen: Sie belegen, woher ein Ticket
			kommt. Sie gehen, wenn ihr Eintrag verworfen und geleert wird.
		</p>
	</section>

	{#if overview.files.largest.length > 0}
		<section class="part" aria-labelledby={`${uid}-largest`}>
			<h3 id={`${uid}-largest`}>Größte Einträge</h3>
			<ol class="largest">
				{#each overview.files.largest as entry (entry.item)}
					{@const belongs = belongsText(entry)}
					<li>
						<a href={inboxItemHref(entry.item)}>{entry.title || 'Ohne Titel'}</a>
						<span class="size">{bytesText(entry.bytes)}</span>
						{#if belongs !== ''}<span class="note">{belongs}</span>{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<section class="part" aria-labelledby={`${uid}-backups`}>
		<h3 id={`${uid}-backups`}>Sicherungen</h3>
		<dl class="rows">
			<div class="row">
				<dt>Hier (pb_data\backups)</dt>
				<dd>{summaryText(overview.backups.local)}</dd>
			</div>
			<div class="row">
				<dt>Im Zielverzeichnis</dt>
				<dd>{targetText}</dd>
			</div>
			{#if overview.backups.pocketbase.count > 0}
				<div class="row">
					<dt>Alte Sicherungen von PocketBase</dt>
					<dd>{summaryText(overview.backups.pocketbase)}</dd>
				</div>
			{/if}
			{#if overview.backups.other.count > 0}
				<div class="row">
					<dt>Andere Sicherungen</dt>
					<dd>{summaryText(overview.backups.other)}</dd>
				</div>
			{/if}
			{#if overview.backups.safety !== null}
				<div class="row">
					<dt>Sicherheitskopien</dt>
					<dd>{summaryText(overview.backups.safety, 'Kopie', 'Kopien')}</dd>
				</div>
			{/if}
		</dl>
		{#if platform === 'windows'}
			<p class="hint">
				Sichern, Aufbewahrung und Zielverzeichnis stehen unter
				<a href={resolve('/einstellungen/sicherung')}>Einstellungen → Sicherung</a> („Jetzt sichern“).
			</p>
		{/if}
	</section>

	{#if overview.program !== null || overview.logs !== null || overview.disk !== null}
		<section class="part" aria-labelledby={`${uid}-program`}>
			<h3 id={`${uid}-program`}>Programm und Logs</h3>
			<dl class="rows">
				{#if overview.logs !== null}
					<div class="row">
						<dt>Logs (app\logs)</dt>
						<dd>{countText(overview.logs)}</dd>
					</div>
				{/if}
				{#if overview.program !== null}
					<div class="row">
						<dt>Programmdateien</dt>
						<dd>{countText(overview.program.files)}</dd>
					</div>
					<div class="row">
						<dt>Reste nach Updates</dt>
						<dd>{countText(overview.program.leftovers)}</dd>
					</div>
					<div class="row">
						<dt>Oberfläche (pb_public)</dt>
						<dd>{webText}</dd>
					</div>
				{/if}
				{#if overview.disk !== null}
					<div class="row">
						<dt>Freier Platz</dt>
						<dd class="disk">
							{overview.disk.text}
							{#if overview.disk.level === 'error'}
								<Lozenge label="Fast voll" icon="error" tone="danger" />
							{:else if overview.disk.level === 'warning'}
								<Lozenge label="Wird knapp" icon="warning" />
							{/if}
						</dd>
					</div>
				{/if}
			</dl>
		</section>
	{/if}

	<section class="part" aria-labelledby={`${uid}-actions`}>
		<h3 id={`${uid}-actions`}>Aufräumen</h3>
		{#if store.actionMessage !== null}
			<SectionMessage tone="warning" live title={store.actionMessage.title}>
				{store.actionMessage.text}
			</SectionMessage>
		{/if}

		<div class="block">
			<h4>{ACTION_TEXTS.vacuum.title}</h4>
			<p class="hint" id={`${uid}-vacuum`}>
				{ACTION_TEXTS.vacuum.text} Frei in den Datenbanken: {bytesText(freeInDatabases)}.
			</p>
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				aria-describedby={`${uid}-vacuum`}
				aria-disabled={busy && store.busy !== 'vacuum'}
				aria-busy={store.busy === 'vacuum'}
				onclick={() => {
					if (!busy) asking = 'vacuum';
				}}
			>
				{askLabel('vacuum')}
			</button>
		</div>

		<div class="block">
			<h4>{ACTION_TEXTS.leftovers.title}</h4>
			<p class="hint">{ACTION_TEXTS.leftovers.text}</p>
			<fieldset class="choices">
				<legend class="visually-hidden">Was aufgeräumt wird</legend>
				{#each LEFTOVER_GROUPS as group (group)}
					{@const entry = overview.actions.leftovers[group]}
					<label class="choice">
						<input
							type="checkbox"
							checked={groups.includes(group)}
							disabled={entry === null}
							onchange={(event) => toggle(group, event.currentTarget.checked)}
						/>
						<span>
							{LEFTOVER_LABELS[group]}:
							{entry === null ? 'nur unter Windows' : countText(entry, 'Eintrag', 'Einträge')}
						</span>
					</label>
				{/each}
			</fieldset>
			<p class="hint" id={`${uid}-leftovers`}>{previewText(chosenLeftovers)}</p>
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				aria-describedby={`${uid}-leftovers`}
				aria-disabled={(busy && store.busy !== 'leftovers') || groups.length === 0}
				aria-busy={store.busy === 'leftovers'}
				onclick={() => {
					if (!busy && groups.length > 0) asking = 'leftovers';
				}}
			>
				{askLabel('leftovers')}
			</button>
		</div>

		<div class="block">
			<h4>{ACTION_TEXTS.discarded.title}</h4>
			<p class="hint" id={`${uid}-discarded`}>
				{ACTION_TEXTS.discarded.text}
				{previewText([overview.actions.discarded])}
			</p>
			{#if boundText !== ''}
				<p class="hint">
					{boundText}
					<a href={trashHref()}>Im Papierkorb entscheiden</a>
				</p>
			{/if}
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				aria-describedby={`${uid}-discarded`}
				aria-disabled={(busy && store.busy !== 'discarded') ||
					overview.actions.discarded.count === 0}
				aria-busy={store.busy === 'discarded'}
				onclick={() => {
					if (!busy && overview.actions.discarded.count > 0) asking = 'discarded';
				}}
			>
				{askLabel('discarded')}
			</button>
		</div>

		<p class="hint">
			Tickets löschst du über den <a href={trashHref()}>Papierkorb</a>; endgültig geht dort nur, was
			keine offenen Abhängigkeiten mehr hat.
		</p>
	</section>
{/if}

<ConfirmDialog
	open={asking !== null}
	title={asking === null ? '' : `${ACTION_TEXTS[asking].title}?`}
	confirmLabel={asking === null ? '' : ACTION_TEXTS[asking].title}
	onconfirm={() => void confirmed()}
	oncancel={() => (asking = null)}
>
	<p>
		{#if asking === 'vacuum'}
			{ACTION_TEXTS.vacuum.text}
		{:else if asking === 'leftovers'}
			{previewText(chosenLeftovers)} Das lässt sich nicht rückgängig machen.
		{:else if asking === 'discarded' && overview !== null}
			{previewText([overview.actions.discarded])} Text und Originaldateien gehen; das lässt sich nicht
			rückgängig machen.
		{/if}
	</p>
</ConfirmDialog>

<style>
	.intro,
	.note,
	.hint {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.part {
		display: grid;
		gap: 0.625rem;
		margin-top: 1rem;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.rows {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.5rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	.row.sub dt {
		padding-left: 1rem;
	}

	dt {
		flex: 0 0 14rem;
		color: var(--color-text-muted);
	}

	dd {
		flex: 1 1 16rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.disk {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
	}

	.largest {
		display: grid;
		gap: 0.375rem;
		padding-left: 1.5rem;
		font-size: var(--font-size-body);
		list-style: decimal;
	}

	.largest li {
		overflow-wrap: anywhere;
	}

	.size {
		margin-left: 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.largest .note {
		margin-left: 0.5rem;
	}

	.action,
	.block {
		display: grid;
		gap: 0.375rem;
		justify-items: start;
		padding: 0.25rem 0 0.5rem;
	}

	.choices {
		display: grid;
		gap: 0.25rem;
		padding: 0;
		border: 0;
	}

	.choice {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-size: var(--font-size-body);
	}
</style>
