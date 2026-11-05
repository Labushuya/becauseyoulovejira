<script lang="ts">
	import { PROBLEM_TEXTS } from '$lib/domain/problems';
	import { PROBLEM_LOG_TEXTS, SERVER_PROBLEM_TEXTS } from '$lib/domain/server-problems';
	import { problemLogHref } from '$lib/settings-sections';
	import { problemLog, type ProblemView } from '$lib/stores/problem-log.svelte';
	import Modal from '../overlay/Modal.svelte';
	import ProblemViewSwitch from './ProblemViewSwitch.svelte';
	import ServerProblemList from './ServerProblemList.svelte';
	import SessionProblemList from './SessionProblemList.svelte';

	// Dialog of the errors (FP-1, ADR-0071 §4; since FP-2, ADR-0077, with the log of the server): the
	// root layout renders it once while the list asks for it (problemLog.dialogOpen) or the address
	// names an entry of the server (`?fehler=<id>`). Two lists with the same building blocks, switched
	// above them: "Diese Sitzung (n)" (the errors of this tab, as before) and "Server" (what the server
	// kept and the account may see). The title names the shown list. Without a session only the list
	// of this tab. Modal M; the focus goes back to the button that opened it. Since FP-3 the footer
	// leads to the page "Fehlerprotokoll" with filters and more than 50 entries: the link closes the
	// dialog of the list, and the new address has no entry of the server, so it closes for one as well.
	let {
		onclose,
		focus = null,
		signedIn = true
	}: {
		onclose: () => void;
		/** ID of the entry of the server the address names, or null. */
		focus?: string | null;
		/** Only with a session the log of the server and the page "Fehlerprotokoll". */
		signedIn?: boolean;
	} = $props();

	// The list the dialog opened with (the server for an entry of the address); the switch changes it.
	let chosen = $state<ProblemView | null>(null);
	const current = $derived<ProblemView>(
		signedIn ? (chosen ?? (focus !== null ? 'server' : 'session')) : 'session'
	);
	const title = $derived(
		current === 'server' ? SERVER_PROBLEM_TEXTS.title : PROBLEM_TEXTS.listTitle
	);
</script>

<Modal open size="m" {title} {onclose}>
	{#if signedIn}
		<div class="views">
			<ProblemViewSwitch {current} onchoose={(view) => (chosen = view)} />
		</div>
	{/if}
	{#if current === 'server'}
		<ServerProblemList {focus} />
	{:else}
		<SessionProblemList />
	{/if}

	{#snippet footer({ close })}
		{#if signedIn}
			<a
				class="button-subtle log-link"
				href={problemLogHref()}
				onclick={() => problemLog.closeDialog()}>{PROBLEM_LOG_TEXTS.open}</a
			>
		{/if}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
	{/snippet}
</Modal>

<style>
	.views {
		margin-bottom: 0.75rem;
	}

	/* On the left of the footer, "Schließen" stays on the right (Modal). */
	.log-link {
		margin-right: auto;
	}
</style>
