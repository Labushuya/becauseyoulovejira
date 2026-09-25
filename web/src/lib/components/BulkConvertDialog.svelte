<script lang="ts">
	import { tick } from 'svelte';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { isPriority, isStatus, type Priority, type Status } from '$lib/domain/status';
	import {
		DEFAULT_PRIORITY,
		DEFAULT_STATUS,
		type ProjectRef,
		type TagRef
	} from '$lib/domain/ticket';
	import type { BulkConverter } from '$lib/stores/bulk-convert.svelte';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import { ticketPath } from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';

	// "Gesammelt umwandeln" (E4 plan, T-2 and package 3; ADR-0014 section 4): a modal dialog with
	// the default values status, priority, project and tags for every chosen entry. Title and
	// description come from each entry. The entries are converted one after the other; a progress
	// bar and a live region follow, failures are listed per entry with their reason, and entries
	// that succeeded stay converted. No due date: the date at the sender never becomes one (P-5).
	// On the modal building block (ADR-0025 section 3, size M): while the run goes on nothing
	// closes, and Escape keeps its own rule "Nach diesem Eintrag anhalten" (plan UI-4).
	let {
		items,
		converter,
		projects = [],
		tags = [],
		oncreatetag = async () => ({ ok: false, message: null }),
		onclose
	}: {
		/** Chosen new entries, in the order of the table. */
		items: readonly Pick<InboxItemSummary, 'id' | 'title'>[];
		converter: BulkConverter;
		/** Projects that can be chosen (the active ones). */
		projects?: readonly ProjectRef[];
		/** Tags that can be chosen (the catalog). */
		tags?: readonly TagRef[];
		oncreatetag?: (name: string) => Promise<EnsureTagResult>;
		/** Cancel, or "Schließen" after the run. */
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		tags: `${uid}-tags`,
		tagsError: `${uid}-tags-error`
	};

	let status = $state<Status>(DEFAULT_STATUS);
	let priority = $state<Priority>(DEFAULT_PRIORITY);
	let project = $state('');
	let tagIds = $state<string[]>([]);
	let tagText = $state('');
	let tagError = $state<string | null>(null);
	/** The run has started; the form gives way to progress and results. */
	let started = $state(false);

	let closeButton = $state<HTMLButtonElement>();

	const count = $derived(items.length);
	const heading = $derived(count === 1 ? '1 Eintrag umwandeln' : `${count} Einträge umwandeln`);
	const chosenTags = $derived(
		tagIds.flatMap((tagId) => {
			const tag = tags.find((entry) => entry.id === tagId);
			return tag === undefined ? [] : [tag];
		})
	);
	const running = $derived(converter.running);
	const handled = $derived(converter.results.length);
	const finished = $derived(started && !running);
	const progressText = $derived(
		`${handled} von ${converter.total} bearbeitet, ${converter.converted} umgewandelt.`
	);
	const summary = $derived.by(() => {
		const failed = converter.failed.length;
		const converted = converter.converted;
		const done = converted === 1 ? '1 Eintrag umgewandelt' : `${converted} Einträge umgewandelt`;
		if (failed === 0) return `${done}.`;
		return `${done}, ${failed} nicht umgewandelt.`;
	});

	async function start(event: SubmitEvent) {
		event.preventDefault();
		if (started || count === 0) return;
		started = true;
		await converter.run(items, {
			status,
			priority,
			project: project === '' ? null : project,
			tags: tagIds
		});
		await tick();
		closeButton?.focus();
	}

	function addTag(tagId: string): boolean {
		if (!tagIds.includes(tagId)) tagIds = [...tagIds, tagId];
		tagError = null;
		return true;
	}

	async function createTag(name: string): Promise<boolean> {
		const result = await oncreatetag(name);
		if (!result.ok) {
			tagError = result.message;
			return false;
		}
		return addTag(result.tag.id);
	}
</script>

<Modal
	open
	size="m"
	title={heading}
	busy={running}
	onbusyescape={() => converter.stop()}
	onclose={() => onclose()}
>
	{#if !started}
		<form id={ids.form} class="form" onsubmit={start}>
			<p class="hint">
				Titel und Text kommen aus dem jeweiligen Eintrag. Diese Werte gelten für alle; eine
				Fälligkeit wird nicht gesetzt.
			</p>
			<div class="row">
				<div class="field">
					<label for={ids.status}>Status</label>
					<StatusSelect
						id={ids.status}
						value={status}
						error={null}
						errorId={`${ids.status}-error`}
						onchoose={(value) => {
							if (isStatus(value)) status = value;
						}}
					/>
				</div>
				<div class="field">
					<label for={ids.priority}>Priorität</label>
					<PrioritySelect
						id={ids.priority}
						value={priority}
						error={null}
						errorId={`${ids.priority}-error`}
						onchoose={(value) => {
							if (isPriority(value)) priority = value;
						}}
					/>
				</div>
			</div>
			<div class="field">
				<label for={ids.project}>Projekt</label>
				<ProjectSelect
					id={ids.project}
					value={project}
					{projects}
					error={null}
					errorId={`${ids.project}-error`}
					hintId={ids.projectHint}
					onchoose={(value) => (project = value)}
				/>
			</div>
			<div class="field">
				<label for={ids.tags}>Tags</label>
				<TagPicker
					id={ids.tags}
					selected={chosenTags}
					{tags}
					bind:text={tagText}
					error={tagError}
					errorId={ids.tagsError}
					onadd={addTag}
					onremove={(tagId) => {
						tagIds = tagIds.filter((entry) => entry !== tagId);
						return true;
					}}
					oncreate={createTag}
				/>
				{#if tagError}
					<p class="field-error" id={ids.tagsError}><ErrorIcon /><span>{tagError}</span></p>
				{/if}
			</div>
		</form>
	{:else}
		<div class="progress">
			<progress max={converter.total} value={handled} aria-label={heading}></progress>
			<p aria-live="polite">{finished ? summary : progressText}</p>
		</div>

		{#if finished && converter.failed.length > 0}
			<div class="alert-error failures">
				<h3>Nicht umgewandelt</h3>
				<ul>
					{#each converter.failed as result (result.id)}
						<li>
							<ErrorIcon />
							<span>„{result.title}“: {result.ok ? '' : result.message}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if finished && converter.converted > 0}
			<details class="created">
				<summary>Angelegte Tickets</summary>
				<ul>
					{#each converter.results as result (result.id)}
						{#if result.ok}
							<li><a href={ticketPath(result.ticketId)}>{result.key}</a> {result.title}</li>
						{/if}
					{/each}
				</ul>
			</details>
		{/if}
	{/if}

	{#snippet footer({ close })}
		{#if !started}
			<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
			<button class="button-primary" type="submit" form={ids.form}>{heading}</button>
		{:else if running}
			<button class="button-secondary" type="button" onclick={() => converter.stop()}>
				Nach diesem Eintrag anhalten
			</button>
		{:else}
			<button class="button-primary" type="button" bind:this={closeButton} onclick={close}>
				Schließen
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	h3 {
		margin-bottom: 0.25rem;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.form {
		display: grid;
		gap: 1rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
	}

	.field {
		display: grid;
		gap: 0.375rem;
		align-content: start;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.form :global(select) {
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.progress {
		display: grid;
		gap: 0.5rem;
	}

	progress {
		width: 100%;
		accent-color: var(--color-brand);
	}

	.failures {
		display: block;
	}

	.failures ul,
	.created ul {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8125rem;
	}

	.failures li {
		display: flex;
		gap: 0.375rem;
		align-items: flex-start;
	}

	.created {
		font-size: 0.8125rem;
	}

	.created a {
		font-family: var(--font-mono);
		color: var(--color-brand-text);
	}
</style>
