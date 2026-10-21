<script lang="ts">
	import { CLOCK_CODE, OFFLINE_TEXTS, reasonOf } from '$lib/domain/offline';
	import type { OutboxStore } from '$lib/offline/outbox.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';

	// The hints of the outbox above the page (OF-2, concept OF-0 §2.1): without a connection a
	// warning without red (it replaces LiveUpdateNotice) with "Erneut versuchen" and, with kept
	// changes, their number and "Ansehen"; a conflict, an action older than 48 hours and one whose
	// time of the device lies in the future (OF-2b) as a warning, a refusal and errors of the server
	// several times in a row as an error with "Details".
	// "Ansehen" opens the dialog "Gemerkte Änderungen"; nothing opens on its own (ADR-0025). The
	// status region is always there while the outbox works, so screen readers hear a hint when it
	// appears and the progress of the transfer; the focus never moves because of it.
	// Since OF-3b round 3 the notices of the outbox stand here as warnings until "Schließen": what the
	// deletion after 7 days took, a sub-task a completion should have taken along that is not done.
	let { outbox, onshow }: { outbox: OutboxStore; onshow: () => void } = $props();

	const uid = $props.id();
	const notices = $derived(outbox.notices);
	const offline = $derived(outbox.offline);
	const conflicts = $derived(outbox.conflicts);
	const refusals = $derived(outbox.refusals);
	const expired = $derived(outbox.expired);
	const aged = $derived(expired.filter((action) => action.outcome?.code !== CLOCK_CODE));
	const clocked = $derived(expired.filter((action) => action.outcome?.code === CLOCK_CODE));
	const failing = $derived(outbox.failing);
	const progress = $derived(outbox.progress);
	const busy = $derived(outbox.checking ? 'true' : undefined);
	const decisions = $derived(conflicts.length + refusals.length + expired.length);
	const shown = $derived(offline || decisions > 0 || failing !== null || notices.length > 0);

	function keyOf(key: string): string {
		return key === '' ? 'Ein Ticket' : key;
	}

	function offlineText(): string {
		return outbox.count === 0 ? OFFLINE_TEXTS.offline : OFFLINE_TEXTS.offlineWith(outbox.count);
	}

	function conflictText(): string {
		return OFFLINE_TEXTS.conflicts(conflicts.length, keyOf(conflicts[0]?.key ?? ''));
	}

	function refusalText(): string {
		const first = refusals[0];
		if (first === undefined) return '';
		return OFFLINE_TEXTS.refusals(refusals.length, keyOf(first.key), reasonOf(first));
	}

	function refusalProblem() {
		const first = refusals[0];
		return first === undefined ? null : outbox.problemOf(first.op);
	}

	function progressText(): string {
		if (progress === null) return '';
		if (progress.count === 1) return OFFLINE_TEXTS.sending(1);
		return OFFLINE_TEXTS.progress(progress.index, progress.count);
	}

	function retry() {
		void outbox.retry();
	}
</script>

<div class="offline-notice" class:shown role="status">
	{#if offline}
		<SectionMessage tone="warning">
			{offlineText()}
			{#snippet actions()}
				<button class="button-subtle" type="button" aria-busy={busy} onclick={retry}>
					{OFFLINE_TEXTS.retry}
				</button>
				{#if outbox.count > 0}
					<button class="button-subtle" type="button" onclick={onshow}>{OFFLINE_TEXTS.show}</button>
				{/if}
			{/snippet}
		</SectionMessage>
	{/if}
	{#if conflicts.length > 0}
		<SectionMessage tone="warning">
			{conflictText()}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={onshow}>{OFFLINE_TEXTS.show}</button>
			{/snippet}
		</SectionMessage>
	{/if}
	{#if refusals.length > 0}
		<SectionMessage tone="error" problem={refusalProblem()}>
			{refusalText()}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={onshow}>{OFFLINE_TEXTS.show}</button>
			{/snippet}
		</SectionMessage>
	{/if}
	{#if aged.length > 0}
		<SectionMessage tone="warning">
			{OFFLINE_TEXTS.expired(aged.length)}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={onshow}>{OFFLINE_TEXTS.show}</button>
			{/snippet}
		</SectionMessage>
	{/if}
	{#if clocked.length > 0}
		<SectionMessage tone="warning">
			{OFFLINE_TEXTS.clockExpired(clocked.length)}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={onshow}>{OFFLINE_TEXTS.show}</button>
			{/snippet}
		</SectionMessage>
	{/if}
	{#each notices as notice (notice.id)}
		<SectionMessage tone="warning">
			<span id={`${uid}-${notice.id}`}>{notice.text}</span>
			{#snippet actions()}
				<button
					class="button-subtle"
					type="button"
					aria-describedby={`${uid}-${notice.id}`}
					onclick={() => outbox.closeNotice(notice.id)}
				>
					{OFFLINE_TEXTS.closeNotice}
				</button>
			{/snippet}
		</SectionMessage>
	{/each}
	{#if failing !== null && !offline}
		<SectionMessage tone="error" problem={failing.problem}>
			{OFFLINE_TEXTS.failed}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={retry}>{OFFLINE_TEXTS.retry}</button>
			{/snippet}
		</SectionMessage>
	{/if}
	{#if progress !== null && !offline}
		<p class="visually-hidden">{progressText()}</p>
	{/if}
</div>

<style>
	.offline-notice {
		display: grid;
		gap: 0.5rem;
	}

	.shown {
		margin-bottom: 1rem;
	}
</style>
