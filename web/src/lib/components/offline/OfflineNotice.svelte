<script lang="ts">
	import { tick } from 'svelte';
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
	// Since OF-3c they come from the device, in every tab; after "Schließen" the focus goes to the next
	// "Schließen", else to the region (`tabindex="-1"`), never to the page (R3-3); where the region goes
	// with the last notice, to the heading of the view or the main content (round 2, C-3), with a
	// `tabindex` only until the focus leaves it (round 3, C2-1).
	let { outbox, onshow }: { outbox: OutboxStore; onshow: () => void } = $props();

	const uid = $props.id();
	let region: HTMLDivElement | undefined = $state();
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

	/** The "Schließen" of every notice, in their order. */
	function closeButtons(): HTMLButtonElement[] {
		return [...(region?.querySelectorAll<HTMLButtonElement>('button[data-closes]') ?? [])];
	}

	/**
	 * Moves the focus to `target` and says whether it took it. One without a `tabindex` of its own gets
	 * `-1` only until the focus leaves it, so the main content is no stop of the focus anywhere else in
	 * the app (round 3, C2-1); one that does not take the focus (a hidden heading, say) stays as it was
	 * (C2-6).
	 */
	function rest(target: HTMLElement): boolean {
		const own = target.hasAttribute('tabindex');
		if (!own) target.tabIndex = -1;
		target.focus({ preventScroll: true });
		const taken = document.activeElement === target;
		if (own) return taken;
		if (taken) {
			target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
		} else target.removeAttribute('tabindex');
		return taken;
	}

	/**
	 * "Schließen": the notice goes, the focus moves to the next "Schließen" or to the region. Where the
	 * region goes with the last notice (the layout shows it outside the phone frame only for the notices),
	 * to the heading of the view (`data-view-heading`) in the main content, else to the main content
	 * (round 2, C-3; round 3, C2-1 and C2-6).
	 */
	async function close(id: string) {
		const buttons = closeButtons();
		const index = buttons.findIndex((button) => button.dataset.closes === id);
		const next = (buttons[index + 1] ?? buttons[index - 1])?.dataset.closes;
		const main = region?.closest<HTMLElement>('main') ?? null;
		const closing = outbox.closeNotice(id);
		await tick();
		const target = closeButtons().find((button) => button.dataset.closes === next);
		if (target !== undefined) target.focus();
		else if (region?.isConnected === true) region.focus();
		else if (main !== null) {
			const heading = main.querySelector<HTMLElement>('[data-view-heading]');
			if (heading === null || !rest(heading)) rest(main);
		}
		await closing;
	}
</script>

<div class="offline-notice" class:shown role="status" tabindex="-1" bind:this={region}>
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
					data-closes={notice.id}
					aria-describedby={`${uid}-${notice.id}`}
					onclick={() => void close(notice.id)}
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
