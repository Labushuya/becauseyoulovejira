<script lang="ts">
	import { isCalendarDate } from '$lib/domain/berlin-date';
	import { formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import { PRIORITY_LABELS, STATUS_LABELS } from '$lib/domain/labels';
	import { personLabel } from '$lib/domain/people';
	import type { ProjectRef } from '$lib/domain/ticket';
	import {
		blockedRetentionText,
		daysLeftText,
		type RestoreNeed,
		type RestoreOptions,
		type TrashPreview
	} from '$lib/domain/trash';
	import type { ResolveAction } from '$lib/domain/trash-dependencies';
	import type { SourceActionResult } from '$lib/stores/ticket-sources.svelte';
	import Markdown from './Markdown.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import { trashItemHref } from '$lib/ticket-links';
	import TrashDependencies from './TrashDependencies.svelte';
	import TrashNeedQuestion from './TrashNeedQuestion.svelte';

	// Read-only preview of a ticket in the trash (ADR-0037 §9), on the side panel next to the table:
	// key, title, the fields, the description (sanitised Markdown, no editing, no ticking), the
	// sub-tasks of its group and what happens to its sources, when and by whom it was deleted and
	// when it goes for good. The footer offers "Wiederherstellen" and "Endgültig löschen …"; a
	// sub-task of a group has none (it comes back with its parent). A restore that needs a choice
	// asks inline, like in the row. A blocked ticket (ADR-0047) shows the decision help right below
	// its fields; "Endgültig löschen …" stays locked until nothing blocks it.
	let {
		preview,
		selfId,
		projects,
		need,
		needKey,
		busy = false,
		onrestore,
		onresolve,
		ondetach,
		onpurge,
		ondismissneed,
		onclose
	}: {
		preview: TrashPreview;
		selfId: string | null;
		projects: readonly ProjectRef[];
		need: RestoreNeed | null;
		/** Key of the ticket the need is about, when it is a sub-task restored on its own. */
		needKey?: string;
		busy?: boolean;
		onrestore: (options: RestoreOptions) => void;
		/** The decisions of the decision help (ADR-0047). */
		onresolve: (actions: readonly ResolveAction[]) => Promise<SourceActionResult<TrashPreview>>;
		/** A sub-task of the group alone, as a ticket of its own. */
		ondetach: (ticketId: string) => void;
		/** "Endgültig löschen …": the owner asks before. */
		onpurge: () => void;
		ondismissneed: () => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const blockedId = `${uid}-blocked`;
	const blocked = $derived(preview.dependencyList.length > 0);
	const due = $derived.by(() => {
		const date = preview.due.slice(0, 10);
		return isCalendarDate(date) ? date : null;
	});
</script>

<Drawer labelledby={titleId} {onclose}>
	{#snippet context()}<span class="key">{preview.key}</span> · im Papierkorb{/snippet}
	<h2 id={titleId} tabindex="-1">{preview.title}</h2>
	<dl class="meta">
		<div class="row">
			<dt>Status</dt>
			<dd>{STATUS_LABELS[preview.status]}</dd>
		</div>
		<div class="row">
			<dt>Priorität</dt>
			<dd>{PRIORITY_LABELS[preview.priority]}</dd>
		</div>
		<div class="row">
			<dt>Projekt</dt>
			<dd>
				{#if preview.project === null}Kein Projekt{:else}{preview.project.name ||
						preview.project.code}
					({preview.project.code}){#if !preview.project.exists}, gelöscht oder geändert{/if}{/if}
			</dd>
		</div>
		{#if due}
			<div class="row">
				<dt>Fällig</dt>
				<dd>{formatCalendarDate(due)}</dd>
			</div>
		{/if}
		{#if preview.tags.length > 0}
			<div class="row">
				<dt>Tags</dt>
				<dd>{preview.tags.map((tag) => tag.name).join(', ')}</dd>
			</div>
		{/if}
		<div class="row">
			<dt>Gelöscht</dt>
			<dd>
				{formatBerlinDateTime(preview.deletedAt)} von {personLabel(preview.deletedBy, selfId)}
			</dd>
		</div>
		<div class="row">
			<dt>Endgültig gelöscht</dt>
			<dd>
				{blocked ? blockedRetentionText(preview.daysLeft) : daysLeftText(preview.daysLeft)}
			</dd>
		</div>
		{#if preview.sources.count > 0}
			<div class="row">
				<dt>Quellen</dt>
				<dd>
					{preview.sources.count}
					{preview.sources.handling === 'discard'
						? 'bleiben beim Ticket und kommen mit ihm zurück.'
						: 'sind im Eingang und werden beim Wiederherstellen wieder verknüpft, solange sie frei sind.'}
				</dd>
			</div>
		{/if}
	</dl>

	{#if preview.group !== ''}
		<p class="group">
			Diese Unteraufgabe kommt mit ihrem übergeordneten Ticket zurück.
			<a href={trashItemHref(preview.group)}>Übergeordnetes Ticket ansehen</a>
		</p>
	{:else}
		<TrashDependencies
			rootKey={preview.key}
			dependencies={preview.dependencyList}
			{busy}
			{onresolve}
			onrestore={() => onrestore({})}
			{ondetach}
		/>
	{/if}

	<section class="part" aria-labelledby={`${uid}-description`}>
		<h3 id={`${uid}-description`}>Beschreibung</h3>
		{#if preview.description.trim() === ''}
			<p class="muted">Keine Beschreibung.</p>
		{:else}
			<Markdown source={preview.description} />
		{/if}
	</section>

	{#if preview.subtasks.length > 0}
		<section class="part" aria-labelledby={`${uid}-subtasks`}>
			<h3 id={`${uid}-subtasks`}>Unteraufgaben</h3>
			<ul class="subtasks">
				{#each preview.subtasks as child (child.id)}
					<li>
						<span class="key">{child.key}</span>
						{child.title} · {STATUS_LABELS[child.status]}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if need}
		<TrashNeedQuestion
			key={needKey ?? preview.key}
			{need}
			{projects}
			{busy}
			{onrestore}
			oncancel={ondismissneed}
		/>
	{/if}

	{#snippet footer()}
		{#if preview.group === ''}
			{#if blocked}
				<span id={blockedId} class="visually-hidden">Erst über die Abhängigkeiten entscheiden.</span
				>
			{/if}
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				aria-disabled={busy || blocked ? 'true' : undefined}
				aria-busy={busy ? 'true' : undefined}
				aria-describedby={blocked ? blockedId : undefined}
				title={blocked ? 'Erst über die Abhängigkeiten entscheiden.' : undefined}
				onclick={() => {
					if (!busy && !blocked) onpurge();
				}}
			>
				Endgültig löschen …
			</button>
			<button
				class="button-primary"
				type="button"
				aria-disabled={busy ? 'true' : undefined}
				aria-busy={busy ? 'true' : undefined}
				onclick={() => {
					if (!busy) onrestore({});
				}}
			>
				Wiederherstellen
			</button>
		{/if}
	{/snippet}
</Drawer>

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
	}

	.meta {
		display: grid;
		margin: 0.75rem 0;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.375rem 0;
		font-size: var(--font-size-control);
		border-bottom: 1px solid var(--color-line);
	}

	dt {
		flex: 0 0 9rem;
		color: var(--color-text-muted);
	}

	dd {
		flex: 1 1 12rem;
		overflow-wrap: anywhere;
	}

	.part {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.group,
	.muted {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.subtasks {
		display: grid;
		gap: 0.25rem;
		font-size: var(--font-size-control);
	}
</style>
