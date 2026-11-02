<script lang="ts">
	import { page } from '$app/state';
	import { SERVER_PROBLEM_TEXTS, detailsSuffix } from '$lib/domain/server-problems';
	import { channelProblems, withServerProblem, type ChannelProblemLookup } from '$lib/problem-link';

	// "Details" at the last error of a channel card in the background (FP-2, ADR-0077; ADR-0071 §6):
	// a link to the entry of the error log of the server for this connection (`?fehler=<id>` on the
	// current page, the dialog of the errors opens there). The card watches its last error at the
	// lookup of the page "Kanäle" (provideChannelProblems), which asks one query for all cards and only
	// for a new error, not for a new time of a run. It shows the entry only when it belongs to the error
	// shown (not older than the last run); nothing while it asks, without such an entry (an error of
	// before the log, a gone entry), when the question fails (e.g. without a connection) and outside of
	// that page. A small button in the row (44 px in the phone frame through .button-subtle); its name
	// tells it apart from the details of the card.
	let {
		connection,
		name,
		lastError,
		lastRunAt,
		problems = channelProblems()
	}: {
		/** ID of the connection of the card. */
		connection: string;
		/** Name of the card. */
		name: string;
		/** The last error the card shows. */
		lastError: string;
		/** Time of the last run (form of PocketBase), the one that failed with `lastError`. */
		lastRunAt: string | null;
		/** The lookup of the entries; by default that of the page. */
		problems?: ChannelProblemLookup | null;
	} = $props();

	const id = $derived(problems === null ? null : problems.idOf({ connection, lastError }));

	$effect(() => {
		if (problems === null) return;
		return problems.watch({ connection, lastError, lastRunAt });
	});
</script>

{#if id !== null}
	<a
		class="button-subtle server-problem-link"
		href={withServerProblem(page.url, id)}
		data-sveltekit-keepfocus
		data-sveltekit-noscroll
		data-sveltekit-replacestate
	>
		{SERVER_PROBLEM_TEXTS.details}<span class="visually-hidden">{detailsSuffix(name)}</span>
	</a>
{/if}

<style>
	.server-problem-link {
		font-size: var(--font-size-control);
	}
</style>
