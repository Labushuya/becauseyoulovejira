<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Tag } from '$lib/domain/tag';
	import type { CatalogEditor } from '$lib/stores/catalog-editor';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';

	// Section "Deine Tags" of the settings page "Tags" (E3 plan, T-14 and package 14; since the user
	// request after EH-4 no longer below the projects): every tag with "Umbenennen" (inline: Enter
	// saves, Escape cancels) and "Löschen …" with the question how many tickets carry it. The page
	// has the heading h2, so the section starts at h3, like "Deine Verbindungen" on "Kanäle". Answers go into the catalog at once, so the table rows follow. New tags
	// come from the tag picker in the panel and in "Neues Ticket".
	let {
		tags,
		editor,
		onannounce
	}: {
		tags: readonly Tag[];
		editor: Pick<CatalogEditor, 'renameTag' | 'deleteTag' | 'countTicketsWithTag'>;
		/** Polite status message for screen readers. */
		onannounce: (message: string) => void;
	} = $props();

	const uid = $props.id();
	const ids = { heading: `${uid}-heading`, error: `${uid}-rename-error` };

	/** Tag being renamed, its typed name and the error of the last try. */
	let renaming = $state<Tag | null>(null);
	let typed = $state('');
	let renameError = $state<string | null>(null);
	let renameBusy = $state(false);

	/** Tag of the question before deleting; `count` null while it is counted or unknown. */
	let deleting = $state<Tag | null>(null);
	let count = $state<number | null>(null);
	let countFailed = $state(false);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);
	let countController: AbortController | null = null;

	let list = $state<HTMLElement>();
	let input = $state<HTMLInputElement>();

	function buttonOf(tag: Tag, action: 'rename' | 'delete'): HTMLElement | null {
		return (
			list?.querySelector<HTMLElement>(`li[data-tag-id="${tag.id}"] [data-action="${action}"]`) ??
			null
		);
	}

	async function startRename(tag: Tag) {
		renaming = tag;
		typed = tag.name;
		renameError = null;
		await tick();
		input?.focus();
		input?.select();
	}

	async function stopRename(tag: Tag) {
		renaming = null;
		renameError = null;
		await tick();
		buttonOf(tag, 'rename')?.focus();
	}

	async function saveRename(event: SubmitEvent) {
		event.preventDefault();
		const tag = renaming;
		if (tag === null || renameBusy) return;
		renameBusy = true;
		try {
			const result = await editor.renameTag(tag, typed);
			if (result.ok) {
				if (result.value.name !== tag.name) onannounce(`Tag heißt jetzt „${result.value.name}“.`);
				await stopRename(tag);
				return;
			}
			renameError = result.fields.name ?? result.message;
			if (renameError !== null) input?.focus();
		} finally {
			renameBusy = false;
		}
	}

	function onRenameKeydown(event: KeyboardEvent, tag: Tag) {
		if (event.key !== 'Escape' || renameBusy) return;
		event.preventDefault();
		event.stopPropagation();
		void stopRename(tag);
	}

	async function startDelete(tag: Tag) {
		deleting = tag;
		count = null;
		countFailed = false;
		deleteError = null;
		countController?.abort();
		const controller = new AbortController();
		countController = controller;
		const result = await editor.countTicketsWithTag(tag, { signal: controller.signal });
		if (countController !== controller) return;
		countController = null;
		if (result.ok) count = result.value;
		else countFailed = result.message !== null;
	}

	/** Ends the question; the dialog returns the focus (to the heading of the view if the tag is gone). */
	function endDelete() {
		countController?.abort();
		countController = null;
		deleting = null;
	}

	async function confirmDelete() {
		const tag = deleting;
		if (tag === null || deleteBusy) return;
		deleteBusy = true;
		deleteError = null;
		try {
			const result = await editor.deleteTag(tag);
			if (result.ok) {
				onannounce(`Tag „${tag.name}“ gelöscht.`);
				endDelete();
			} else {
				deleteError = result.message ?? result.fields.name ?? null;
			}
		} finally {
			deleteBusy = false;
		}
	}

	function usage(value: number | null): string {
		if (countFailed) return 'Wie viele Tickets ihn tragen, ließ sich nicht ermitteln.';
		if (value === null) return 'Die Tickets mit diesem Tag werden gezählt …';
		if (value === 0) return 'Kein Ticket trägt diesen Tag.';
		const tickets = value === 1 ? '1 Ticket' : `${value} Tickets`;
		return `Es wird bei ${tickets} entfernt. Deren Verlauf zeigt die Änderung.`;
	}
</script>

<section class="tag-manager" aria-labelledby={ids.heading}>
	<div class="head">
		<h3 id={ids.heading}>Deine Tags</h3>
		<span class="count">
			<span aria-hidden="true">{tags.length}</span>
			<span class="visually-hidden">{tags.length === 1 ? '1 Tag' : `${tags.length} Tags`}</span>
		</span>
	</div>

	{#if tags.length === 0}
		<EmptyState
			size="compact"
			headingLevel={4}
			title="Noch keine Tags"
			description="Tags entstehen im Detail eines Tickets oder bei „Neues Ticket“; hier benennst du sie später um."
		>
			{#snippet secondary()}
				<a class="button-secondary" href={resolve('/tickets/neu')}>Ticket anlegen</a>
			{/snippet}
		</EmptyState>
	{:else}
		<ul class="tag-list" bind:this={list}>
			{#each tags as tag (tag.id)}
				<li data-tag-id={tag.id}>
					{#if renaming?.id === tag.id}
						<form
							class="rename"
							novalidate
							aria-busy={renameBusy ? 'true' : undefined}
							onsubmit={saveRename}
						>
							<label class="visually-hidden" for={`${uid}-${tag.id}`}>
								Neuer Name für den Tag „{tag.name}“
							</label>
							<input
								id={`${uid}-${tag.id}`}
								type="text"
								autocomplete="off"
								bind:value={typed}
								bind:this={input}
								aria-invalid={renameError ? 'true' : undefined}
								aria-describedby={renameError ? ids.error : undefined}
								onkeydown={(event) => onRenameKeydown(event, tag)}
							/>
							<button class="small primary" type="submit" aria-disabled={renameBusy}>
								{renameBusy ? 'Wird gespeichert …' : 'Speichern'}
							</button>
							<button
								class="small"
								type="button"
								aria-disabled={renameBusy}
								onclick={() => {
									if (!renameBusy) void stopRename(tag);
								}}
							>
								Abbrechen
							</button>
							{#if renameError}
								<p class="field-error" id={ids.error}><ErrorIcon /><span>{renameError}</span></p>
							{/if}
						</form>
					{:else}
						<span class="name">{tag.name}</span>
						<button
							class="small"
							type="button"
							data-action="rename"
							aria-label={`Tag „${tag.name}“ umbenennen`}
							onclick={() => void startRename(tag)}
						>
							Umbenennen
						</button>
						<button
							class="small"
							type="button"
							data-action="delete"
							aria-label={`Tag „${tag.name}“ löschen …`}
							onclick={() => void startDelete(tag)}
						>
							Löschen …
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<ConfirmDialog
		open={deleting !== null}
		title={deleting === null ? 'Tag löschen?' : `Tag „${deleting.name}“ löschen?`}
		confirmLabel="Löschen"
		busy={deleteBusy}
		error={deleteError}
		onconfirm={() => void confirmDelete()}
		oncancel={() => {
			if (deleting !== null) endDelete();
		}}
	>
		<p>{usage(count)}</p>
	</ConfirmDialog>
</section>

<style>
	.tag-manager {
		display: grid;
		gap: 0.75rem;
	}

	.head {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.count {
		min-width: 1.5rem;
		padding: 0 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.tag-list {
		display: grid;
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
	}

	li + li {
		border-top: 1px solid var(--color-line);
	}

	.name {
		flex: 1;
		min-width: 0;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.rename {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.rename input {
		flex: 1;
		min-width: min(10rem, 100%);
		padding: 0.25rem 0.5rem;
		font-size: 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.small {
		padding: 0.125rem 0.625rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.small.primary {
		color: var(--color-on-brand);
		background: var(--color-brand);
		border-color: var(--color-brand);
	}

	[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.75;
	}

	/* Locked because the new name is being saved (ADR-0026, addendum of 2026-09-30). */
	.rename[aria-busy='true'] [aria-disabled='true'] {
		cursor: progress;
	}
</style>
