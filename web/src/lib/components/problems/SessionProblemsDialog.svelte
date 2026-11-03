<script lang="ts">
	import { PROBLEM_TEXTS } from '$lib/domain/problems';
	import { SERVER_PROBLEM_TEXTS } from '$lib/domain/server-problems';
	import { problemLog, type ProblemView } from '$lib/stores/problem-log.svelte';
	import Modal from '../overlay/Modal.svelte';
	import ServerProblemList from './ServerProblemList.svelte';
	import SessionProblemList from './SessionProblemList.svelte';

	// Dialog of the errors (FP-1, ADR-0071 §4; since FP-2, ADR-0077, with the log of the server): the
	// root layout renders it once while the list asks for it (problemLog.dialogOpen) or the address
	// names an entry of the server (`?fehler=<id>`). Two lists with the same building blocks, switched
	// above them: "Diese Sitzung (n)" (the errors of this tab, as before) and "Server" (what the server
	// kept and the account may see). The title names the shown list. Without a session only the list
	// of this tab. Modal M; the focus goes back to the button that opened it.
	let {
		onclose,
		view = 'session',
		focus = null,
		signedIn = true
	}: {
		onclose: () => void;
		/** The list shown first. */
		view?: ProblemView;
		/** ID of the entry of the server the address names, or null. */
		focus?: string | null;
		/** Only with a session the log of the server. */
		signedIn?: boolean;
	} = $props();

	// The list the dialog opened with; the switch changes it.
	let chosen = $state<ProblemView | null>(null);
	const current = $derived<ProblemView>(
		signedIn ? (chosen ?? (focus !== null ? 'server' : view)) : 'session'
	);
	const title = $derived(
		current === 'server' ? SERVER_PROBLEM_TEXTS.title : PROBLEM_TEXTS.listTitle
	);
</script>

<Modal open size="m" {title} {onclose}>
	{#if signedIn}
		<div class="segmented views" role="group" aria-label={SERVER_PROBLEM_TEXTS.views}>
			<button
				type="button"
				aria-pressed={current === 'session'}
				onclick={() => (chosen = 'session')}
			>
				{SERVER_PROBLEM_TEXTS.session} ({problemLog.count})
			</button>
			<button type="button" aria-pressed={current === 'server'} onclick={() => (chosen = 'server')}>
				{SERVER_PROBLEM_TEXTS.server}
			</button>
		</div>
	{/if}
	{#if current === 'server'}
		<ServerProblemList {focus} />
	{:else}
		<SessionProblemList />
	{/if}

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
	{/snippet}
</Modal>

<style>
	.views {
		justify-self: start;
		margin-bottom: 0.75rem;
	}
</style>
