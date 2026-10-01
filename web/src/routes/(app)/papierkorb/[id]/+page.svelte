<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import Drawer from '$lib/components/overlay/Drawer.svelte';
	import TrashPanel from '$lib/components/TrashPanel.svelte';
	import type { RestoreOptions, TrashPreview } from '$lib/domain/trash';
	import type { ResolveAction } from '$lib/domain/trash-dependencies';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { getTrashStore } from '$lib/stores/trash.svelte';
	import { trashHref } from '$lib/ticket-links';

	// Preview of one ticket in the trash (/papierkorb/<record id>, ADR-0037 §9), read-only. It loads
	// through the trash route and again when the trash changes (another tab restored or deleted it).
	// "Wiederherstellen" leads to the restored ticket; "Endgültig löschen …" asks first and leads
	// back to the table. The decision help of a blocked ticket (ADR-0047) answers with the preview
	// afterwards; a sub-task restored on its own leaves the preview of its group in place, and a
	// choice its restore needs (target project) asks in the same inline question.
	const store = getTrashStore();
	const catalog = getCatalogStore();
	const links = ticketLinks();
	const id = $derived(page.params.id ?? '');

	let preview = $state<TrashPreview | null>(null);
	let loading = $state(true);
	let failed = $state<string | null>(null);
	let asking = $state(false);
	/** Sub-task being restored on its own ("Lösen und als eigenständiges Ticket …"). */
	let detaching = $state<{ id: string; key: string } | null>(null);

	$effect(() => {
		const current = id;
		// Read again when the trash changes (the list of the store is the signal).
		void store.items;
		const controller = new AbortController();
		loading = untrack(() => preview?.id !== current);
		failed = null;
		store
			.preview(current, controller.signal)
			.then((result) => {
				if (controller.signal.aborted) return;
				preview = result;
				loading = false;
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				failed = error instanceof Error ? error.message : 'Die Vorschau ließ sich nicht laden.';
				loading = false;
			});
		return () => controller.abort();
	});

	async function restore(options: RestoreOptions) {
		if (detaching !== null) {
			await detach(detaching.id, options);
			return;
		}
		const result = await store.restore(id, options);
		if (result !== null) await goto(links.path(result.id));
	}

	async function resolve(actions: readonly ResolveAction[]) {
		const result = await store.resolve(id, actions);
		if (result.ok && result.value.id === id) preview = result.value;
		return result;
	}

	async function detach(ticketId: string, options: RestoreOptions = {}) {
		const key = preview?.dependencyList.find(
			(dependency) => dependency.kind === 'ticket' && dependency.ticket === ticketId
		)?.key;
		detaching = { id: ticketId, key: key ?? detaching?.key ?? '' };
		const result = await store.restore(ticketId, { ...options, detachParent: true });
		if (store.needOf(ticketId) !== null) return;
		detaching = null;
		if (result === null) return;
		const next = await store.preview(id);
		if (next !== null) preview = next;
	}

	function dismissNeed() {
		if (detaching !== null) {
			store.dismissNeed(detaching.id);
			detaching = null;
		} else if (preview) {
			store.dismissNeed(preview.id);
		}
	}

	async function purge() {
		asking = false;
		if (await store.purge(id)) await goto(trashHref());
	}
</script>

<svelte:head>
	<title>{preview ? `${preview.key} · ` : ''}Papierkorb · becauseyoulovejira</title>
</svelte:head>

{#if preview && preview.id === id}
	{@const current = preview}
	<TrashPanel
		preview={current}
		selfId={auth.userId}
		projects={catalog.activeProjects}
		need={detaching !== null ? store.needOf(detaching.id) : store.needOf(current.id)}
		needKey={detaching?.key}
		busy={store.isBusy(current.id) || (detaching !== null && store.isBusy(detaching.id))}
		onrestore={(options) => void restore(options)}
		onresolve={resolve}
		ondetach={(ticketId) => void detach(ticketId)}
		onpurge={() => (asking = true)}
		ondismissneed={dismissNeed}
		onclose={() => goto(trashHref())}
	/>
	<ConfirmDialog
		open={asking}
		title={`${current.key} endgültig löschen?`}
		confirmLabel="Endgültig löschen"
		onconfirm={() => void purge()}
		oncancel={() => (asking = false)}
	>
		<p>
			Das Ticket wird mit seinen Unteraufgaben, Kommentaren und dem Verlauf gelöscht. Das lässt sich
			nicht rückgängig machen.
		</p>
	</ConfirmDialog>
{:else}
	<Drawer labelledby="trash-missing" onclose={() => goto(trashHref())}>
		{#snippet context()}Papierkorb{/snippet}
		{#if loading}
			<h2 id="trash-missing" class="visually-hidden" tabindex="-1">Ticket im Papierkorb</h2>
			<p class="loading" role="status">Vorschau wird geladen …</p>
		{:else if failed}
			<h2 id="trash-missing" tabindex="-1">Ticket im Papierkorb</h2>
			<SectionMessage tone="error">{failed}</SectionMessage>
		{:else}
			<h2 id="trash-missing" tabindex="-1">Nicht im Papierkorb</h2>
			<p>Das Ticket wurde wiederhergestellt oder endgültig gelöscht.</p>
		{/if}
	</Drawer>
{/if}

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	p {
		font-size: var(--font-size-body);
	}

	.loading {
		color: var(--color-text-muted);
	}
</style>
