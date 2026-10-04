<script lang="ts">
	import type { SessionFailure } from '$lib/auth.svelte';
	import { serverUnreachableHint } from '$lib/guidance/texts';
	import CenteredCard from './CenteredCard.svelte';

	// Shown when the stored session could not be checked; the session is kept (E1 plan, package 7).
	// Before the check the context of the tab is unknown, so the hint names no script (KX-1).
	let {
		failure,
		busy,
		onretry
	}: { failure: SessionFailure | null; busy: boolean; onretry: () => void } = $props();

	const TEXTS: Record<SessionFailure, { title: string; body: string }> = {
		network: {
			title: 'Server nicht erreichbar',
			get body() {
				return `Die Anmeldung bleibt erhalten. ${serverUnreachableHint()}`;
			}
		},
		server: {
			title: 'Sitzung konnte nicht geprüft werden',
			body: 'Der Server hat mit einem Fehler geantwortet. Die Anmeldung bleibt erhalten.'
		}
	};

	const text = $derived(TEXTS[failure ?? 'network']);
</script>

<CenteredCard labelledby="session-notice-title">
	<h1 id="session-notice-title">{text.title}</h1>
	<p>{text.body}</p>
	<button
		class="button-primary"
		type="button"
		disabled={busy}
		aria-busy={busy ? 'true' : undefined}
		onclick={onretry}
	>
		{busy ? 'Wird geprüft …' : 'Erneut versuchen'}
	</button>
</CenteredCard>

<style>
	h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}

	p {
		margin-top: 0.5rem;
		color: var(--color-text-muted);
	}

	button {
		width: 100%;
		margin-top: 1.5rem;
	}
</style>
