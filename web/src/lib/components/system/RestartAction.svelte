<script lang="ts">
	import type { Snippet } from 'svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import { RESTART_TEXTS, mailText, stateText } from '$lib/domain/system';
	import { restartElsewhere, type RestartTask } from '$lib/guidance/texts';
	import type { RestartStore } from '$lib/stores/restart.svelte';
	import RestartEmergency from './RestartEmergency.svelte';

	// "Jetzt neu starten" or "Mail-Helfer neu starten" where it is needed, e.g. in a step of a setup
	// assistant (BW-1, ADR-0072), with the route, the checks and the waiting of the page System
	// (RestartStore). The restart asks first (ConfirmDialog; inside a modal the question stands
	// inline, ADR-0025 addendum 16), then says what happens while the server is gone, and the result
	// stays here: the server is back (`onrestarted` checks again), a refusal as a warning, a failure
	// in red with "Details" (FP-1). The files of the folder app stand only folded under „Notfall“
	// (the user's rule: everything from the browser). A tab that may not restart (another device,
	// another account, a server that is not Windows) gets who does what where instead of the button,
	// never a script. Without a store (a view that cannot restart) only the emergency way stands.
	let {
		store,
		task = 'restart',
		place,
		hint,
		onstart,
		onrestarted,
		emergency
	}: {
		store: RestartStore | null;
		task?: RestartTask;
		/** Where the run is started; only this place shows its progress and result. */
		place: string;
		/** Below the button: what it does and what follows. */
		hint: string;
		/** The run begins (after the question). */
		onstart?: () => void;
		/** The server is back resp. the mail helper restarted: check the prerequisite again. */
		onrestarted?: () => void;
		/** More of the emergency way, e.g. the file to double-click. */
		emergency?: Snippet;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;
	let confirming = $state(false);

	const elsewhere = $derived(restartElsewhere(task));
	const busy = $derived((store?.running ?? null) !== null);
	const here = $derived(store?.runningAt(place) ?? false);
	const phase = $derived(store?.phaseAt(place) ?? null);
	const result = $derived(store?.resultAt(place) ?? null);
	const label = $derived(task === 'restart' ? 'Jetzt neu starten' : 'Mail-Helfer neu starten');

	const phaseText = $derived(
		phase === 'preparing'
			? RESTART_TEXTS.preparing
			: phase === 'stopping'
				? RESTART_TEXTS.stopping
				: RESTART_TEXTS.starting
	);

	/** The success or information of a finished run, in one sentence. */
	const finished = $derived.by((): { tone: 'success' | 'info'; text: string } | null => {
		if (result?.kind === 'restarted') {
			const state = result.overview === null ? '' : ` ${stateText(result.overview.status)}.`;
			return { tone: 'success', text: `${RESTART_TEXTS.done}${state}` };
		}
		if (result?.kind === 'mail') {
			if (result.overview.mail.running) return { tone: 'success', text: RESTART_TEXTS.mailDone };
			const { label: state, hint: why } = mailText(result.overview);
			return { tone: 'info', text: `Mail-Helfer: ${state}. ${why}`.trim() };
		}
		return null;
	});

	async function start() {
		if (store === null) return;
		onstart?.();
		const outcome =
			task === 'restart' ? await store.restart(place) : await store.restartMail(place);
		if (outcome?.kind === 'restarted' || outcome?.kind === 'mail') onrestarted?.();
	}

	function ask() {
		if (busy) return;
		if (task === 'restart') confirming = true;
		else void start();
	}

	function confirmRestart() {
		confirming = false;
		void start();
	}
</script>

{#if elsewhere !== null}
	{#if elsewhere.length > 0}
		<SectionMessage tone="info" compact>
			{#each elsewhere as text (text)}<p>{text}</p>{/each}
		</SectionMessage>
	{/if}
{:else}
	<div class="restart" aria-busy={here ? 'true' : undefined}>
		{#if store !== null}
			<div class="action">
				<button
					class="button-secondary"
					type="button"
					aria-busy={here ? 'true' : undefined}
					aria-disabled={busy ? 'true' : undefined}
					aria-describedby={hintId}
					onclick={ask}
				>
					{label}
				</button>
				<p class="hint" id={hintId}>{hint}</p>
			</div>

			<ConfirmDialog
				open={confirming}
				title={RESTART_TEXTS.confirmTitle}
				confirmLabel={RESTART_TEXTS.confirmLabel}
				onconfirm={confirmRestart}
				oncancel={() => (confirming = false)}
			>
				<p>{RESTART_TEXTS.confirm}</p>
				<p>{RESTART_TEXTS.unsaved}</p>
				<p>{RESTART_TEXTS.keepsOpen}</p>
			</ConfirmDialog>

			<div role="status">
				{#if here && task === 'restart'}
					<SectionMessage tone="info" title={RESTART_TEXTS.runningTitle} headingLevel={4}>
						{phaseText}
						{RESTART_TEXTS.keepsOpen}
					</SectionMessage>
				{:else if here}
					<SectionMessage tone="info" title={RESTART_TEXTS.mailRunningTitle} headingLevel={4}>
						{RESTART_TEXTS.mailRunning}
					</SectionMessage>
				{/if}
			</div>

			{#if finished !== null}
				<SectionMessage tone={finished.tone} compact live>{finished.text}</SectionMessage>
			{:else if result?.kind === 'refused' || result?.kind === 'failed'}
				<SectionMessage
					tone={result.kind === 'refused' ? result.tone : 'error'}
					title={result.message.title}
					live
					headingLevel={4}
					problem={result.problem}
				>
					{result.message.text}
				</SectionMessage>
			{/if}
		{/if}

		<RestartEmergency {task}>{@render emergency?.()}</RestartEmergency>
	</div>
{/if}

<style>
	.restart,
	.action {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.action {
		justify-items: start;
		gap: 0.375rem;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
