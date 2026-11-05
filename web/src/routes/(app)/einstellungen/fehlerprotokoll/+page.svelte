<script lang="ts">
	import ProblemViewSwitch from '$lib/components/problems/ProblemViewSwitch.svelte';
	import ServerProblemList from '$lib/components/problems/ServerProblemList.svelte';
	import SessionProblemList from '$lib/components/problems/SessionProblemList.svelte';
	import { serverProblemAreas } from '$lib/domain/server-problems';
	import { helpHref } from '$lib/settings-sections';
	import { findAreaStore } from '$lib/stores/area.svelte';
	import { appContext } from '$lib/stores/context.svelte';
	import type { ProblemView } from '$lib/stores/problem-log.svelte';

	// Settings "Fehlerprotokoll" (FP-3, ADR-0077 addendum FP-3, ADR-0071 addendum FP-3): the lasting
	// place of both lists of the errors, for every account, on every device and in the phone frame. The
	// switch "Diese Sitzung (n) | Server" of the dialog, this tab first as there; "Diese Sitzung" with
	// "Alle kopieren" and "Liste leeren", "Server" with the filters "Quelle" and "Bereich" and "Mehr
	// laden" (ServerProblemList with `browse`). "Bereich" offers "Haushalt" only to a member of a
	// household and "App" only to the administrator of the app (the context of the tab); the filters
	// only narrow, the rules of the server decide what the account sees. Without a connection the list
	// of this tab stays usable, the one of the server says so with "Erneut laden"; nothing goes into the
	// outbox. No special case for `?fehler=<id>`: the root layout opens the dialog for it, as everywhere.
	let view = $state<ProblemView>('session');

	const area = findAreaStore();
	const mode = $derived(appContext.capabilities.mode);
	const areas = $derived(
		serverProblemAreas({
			member: area?.visible ?? false,
			admin: mode === 'pc' || mode === 'remote'
		})
	);
</script>

<svelte:head>
	<title>Fehlerprotokoll · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<div class="problem-log">
	<p class="intro">
		„Diese Sitzung“ zeigt die Fehler dieses Tabs, „Server“ die Fehler, die der Server festgehalten
		hat und dein Konto sehen darf. Was hineinkommt und wer was sieht, steht in der
		<a href={helpHref('fehlerprotokoll')}>Hilfe</a>.
	</p>
	<ProblemViewSwitch current={view} onchoose={(next) => (view = next)} />
	{#if view === 'server'}
		<ServerProblemList browse {areas} />
	{:else}
		<SessionProblemList />
	{/if}
</div>

<style>
	.problem-log {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		min-width: 0;
	}

	.intro {
		color: var(--color-text-muted);
	}

	.intro a {
		color: var(--color-brand-text);
	}
</style>
