<script lang="ts">
	import { CREDENTIAL_TEXTS } from '$lib/domain/credentials';
	import type { CredentialsStore } from '$lib/stores/credentials.svelte';
	import type { RestartStore } from '$lib/stores/restart.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import RestartAction from '../system/RestartAction.svelte';

	// The lasting hint after "Später" (BW-3, ADR-0075 V3): "Neustart nötig, damit geänderte
	// Zugangsdaten wirken". Its state comes from the server (the mark of the last change in the
	// memory of the server), so it stands after a reload and on every device of the administrator,
	// and it goes by itself with the next restart. "Jetzt neu starten" is the restart of the page
	// System (RestartAction; on another device it says who restarts where). No red: nothing failed.
	let {
		store,
		restart = null,
		place
	}: {
		store: CredentialsStore;
		restart?: RestartStore | null;
		/** Where the restart of this hint runs (RestartStore). */
		place: string;
	} = $props();

	function restarted() {
		void store.refreshNotice();
		void store.load();
	}
</script>

{#if store.restartNeeded}
	<SectionMessage tone="warning" title={CREDENTIAL_TEXTS.pendingRestartTitle} headingLevel={4}>
		<p>{CREDENTIAL_TEXTS.pendingRestart}</p>
		<RestartAction
			store={restart}
			{place}
			hint={CREDENTIAL_TEXTS.restartHint}
			onrestarted={restarted}
		/>
	</SectionMessage>
{/if}
