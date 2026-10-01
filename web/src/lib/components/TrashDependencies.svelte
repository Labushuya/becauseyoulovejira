<script lang="ts">
	import { tick } from 'svelte';
	import { CHANNEL_LABELS, isInboxChannel } from '$lib/domain/inbox';
	import type { TrashPreview } from '$lib/domain/trash';
	import {
		COLLECTIVE_LABELS,
		DISCARD_NOTE,
		PRIMARY_SOURCE_NOTE,
		blockedIntro,
		collectiveActions,
		collectivePreview,
		countsOf,
		optionLabel,
		type CollectiveKind,
		type DependencyOption,
		type ResolveAction,
		type SourceDependency,
		type TicketDependency,
		type TrashDependency
	} from '$lib/domain/trash-dependencies';
	import type { SourceActionResult } from '$lib/stores/ticket-sources.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import MoveSourceDialog from './MoveSourceDialog.svelte';
	import StatusPill from './StatusPill.svelte';

	// Decision help of a blocked ticket in the trash (ADR-0047), inline in its preview, no dialog
	// of its own: every dependency of the group with only the options our rules allow. An open
	// ticket: "Als erledigt markieren" (the first ticket with open blocking sub-tasks only together
	// with them, ADR-0033), "Wiederherstellen" and, for a sub-task, "Lösen und als eigenständiges
	// Ticket wiederherstellen". A source: "Zurück in den Eingang", "Verwerfen" and, unless it is the
	// main source (ADR-0031, the help says why), "Anderem Ticket zuordnen …" with the dialog of the
	// sources (a modal from the side panel, like there). The collective ways show what they touch
	// before they run. After a decision the focus goes to the heading; once nothing blocks, a short
	// message says that the ticket can be deleted for good now.
	let {
		rootKey,
		dependencies,
		busy = false,
		onresolve,
		onrestore,
		ondetach
	}: {
		/** Key of the first ticket of the group (the ticket of the preview). */
		rootKey: string;
		dependencies: readonly TrashDependency[];
		/** Another action on the ticket runs (restore, delete). */
		busy?: boolean;
		onresolve: (actions: readonly ResolveAction[]) => Promise<SourceActionResult<TrashPreview>>;
		/** "Wiederherstellen" of the whole group. */
		onrestore: () => void;
		/** "Lösen und als eigenständiges Ticket wiederherstellen" of a sub-task. */
		ondetach: (ticketId: string) => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	let heading = $state<HTMLElement>();
	let pending = $state<CollectiveKind | null>(null);
	let moving = $state<SourceDependency | null>(null);
	let running = $state<string | null>(null);
	let resolvedHere = $state(false);

	const tickets = $derived(
		dependencies.filter(
			(dependency): dependency is TicketDependency => dependency.kind === 'ticket'
		)
	);
	const sources = $derived(
		dependencies.filter(
			(dependency): dependency is SourceDependency => dependency.kind === 'source'
		)
	);
	const counts = $derived(countsOf(dependencies));
	const ways = $derived<CollectiveKind[]>([
		...(tickets.length > 1 ? (['complete'] as const) : []),
		...(sources.length > 1 ? (['inbox', 'discard'] as const) : [])
	]);
	const locked = $derived(busy || running !== null);

	/** Moves through the route of the trash; the dialog shows a refusal itself. */
	const mover = {
		move: (item: { id: string }, ticket: { id: string }) =>
			onresolve([{ action: 'move', item: item.id, target: ticket.id }])
	};

	async function settled(preview: TrashPreview) {
		pending = null;
		resolvedHere = preview.dependencyList.length === 0;
		await tick();
		heading?.focus();
	}

	async function run(id: string, actions: readonly ResolveAction[]) {
		if (locked) return;
		running = id;
		try {
			const result = await onresolve(actions);
			if (result.ok) await settled(result.value);
		} finally {
			running = null;
		}
	}

	function idOf(dependency: TrashDependency): string {
		return dependency.kind === 'ticket' ? dependency.ticket : dependency.item;
	}

	function choose(option: DependencyOption, dependency: TrashDependency) {
		if (locked) return;
		const id = `${idOf(dependency)}:${option}`;
		if (dependency.kind === 'ticket') {
			if (option === 'restore') onrestore();
			else if (option === 'detach') ondetach(dependency.ticket);
			else if (option === 'complete_children') {
				void run(id, [{ action: 'complete', ticket: dependency.ticket, complete_children: true }]);
			} else void run(id, [{ action: 'complete', ticket: dependency.ticket }]);
			return;
		}
		if (option === 'move') moving = dependency;
		else if (option === 'inbox' || option === 'discard') {
			void run(id, [{ action: option, item: dependency.item }]);
		}
	}

	function channelOf(channel: string): string {
		return isInboxChannel(channel) ? CHANNEL_LABELS[channel] : channel;
	}
</script>

{#snippet options(dependency: TrashDependency)}
	<div class="options">
		{#each dependency.options as option (option)}
			{@const label = optionLabel(option, dependency, rootKey)}
			{@const id = `${idOf(dependency)}:${option}`}
			<button
				class="button-subtle"
				type="button"
				aria-label={label.name}
				aria-haspopup={option === 'move' ? 'dialog' : undefined}
				aria-disabled={locked && running !== id ? 'true' : undefined}
				aria-busy={running === id ? 'true' : undefined}
				onclick={() => choose(option, dependency)}
			>
				{label.text}
			</button>
		{/each}
	</div>
{/snippet}

{#if dependencies.length > 0}
	<section class="dependencies" aria-labelledby={headingId}>
		<h3 id={headingId} tabindex="-1" bind:this={heading}>Abhängigkeiten</h3>
		<SectionMessage tone="warning" compact>{blockedIntro(rootKey, counts)}</SectionMessage>

		{#if tickets.length > 0}
			<h4>Nicht erledigt</h4>
			<ul class="list">
				{#each tickets as dependency (dependency.ticket)}
					<li class="entry">
						<p class="what">
							<span class="key">{dependency.key}</span>
							<span class="title">{dependency.title}</span>
							<StatusPill status={dependency.status} />
							{#if dependency.subtask}<span class="note">Unteraufgabe</span>{/if}
						</p>
						{@render options(dependency)}
					</li>
				{/each}
			</ul>
		{/if}

		{#if sources.length > 0}
			<h4>Quellen</h4>
			<ul class="list">
				{#each sources as dependency (dependency.item)}
					<li class="entry">
						<p class="what">
							<span class="title">{dependency.title || 'Ohne Titel'}</span>
							<span class="note">{channelOf(dependency.channel)} · an {dependency.key}</span>
							{#if dependency.primary}<Lozenge label="Hauptquelle" icon="inbox" />{/if}
						</p>
						{@render options(dependency)}
						{#if dependency.primary}<p class="hint">{PRIMARY_SOURCE_NOTE}</p>{/if}
					</li>
				{/each}
			</ul>
			<p class="hint">{DISCARD_NOTE}</p>
		{/if}

		{#if ways.length > 0}
			<h4>Für alle auf einmal</h4>
			<div class="options">
				{#each ways as kind (kind)}
					<button
						class="button-secondary"
						type="button"
						aria-expanded={pending === kind}
						aria-disabled={locked ? 'true' : undefined}
						onclick={() => {
							if (!locked) pending = pending === kind ? null : kind;
						}}
					>
						{COLLECTIVE_LABELS[kind]}
					</button>
				{/each}
			</div>
			{#if pending !== null}
				{@const kind = pending}
				<SectionMessage tone="info" compact>
					{collectivePreview(dependencies, kind)}
					{#snippet actions()}
						<button
							class="button-primary"
							type="button"
							aria-disabled={locked && running !== `all:${kind}` ? 'true' : undefined}
							aria-busy={running === `all:${kind}` ? 'true' : undefined}
							onclick={() => void run(`all:${kind}`, collectiveActions(dependencies, kind))}
						>
							{COLLECTIVE_LABELS[kind]}
						</button>
						<button class="button-secondary" type="button" onclick={() => (pending = null)}>
							Abbrechen
						</button>
					{/snippet}
				</SectionMessage>
			{/if}
		{/if}
	</section>
{:else if resolvedHere}
	<section class="dependencies" aria-labelledby={headingId}>
		<h3 id={headingId} tabindex="-1" bind:this={heading}>Abhängigkeiten</h3>
		<SectionMessage tone="success" compact>
			Alles ist entschieden. {rootKey} lässt sich jetzt endgültig löschen.
		</SectionMessage>
	</section>
{/if}

{#if moving}
	<MoveSourceDialog
		item={{ id: moving.item, title: moving.title, scope: moving.scope }}
		current={{ id: moving.ticket, key: moving.key }}
		store={mover}
		onmoved={(preview) => void settled(preview)}
		onclose={() => (moving = null)}
	/>
{/if}

<style>
	.dependencies {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	h4 {
		margin-top: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.list {
		display: grid;
		gap: 0.5rem;
	}

	.entry {
		display: grid;
		gap: 0.25rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-line);
	}

	.what {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		font-size: var(--font-size-control);
	}

	.title {
		overflow-wrap: anywhere;
	}

	.key {
		font-family: var(--font-mono);
	}

	.note,
	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}
</style>
