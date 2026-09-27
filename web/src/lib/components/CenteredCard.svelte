<script lang="ts">
	import type { Snippet } from 'svelte';

	// Full-page card for screens without the app shell (login, session notice).
	let { labelledby, children }: { labelledby: string; children: Snippet } = $props();
</script>

<main class="screen">
	<section class="card" aria-labelledby={labelledby}>
		{@render children()}
	</section>
</main>

<style>
	.screen {
		display: grid;
		place-items: center;
		min-height: 100vh;
		min-height: 100dvh;
		padding: 1.5rem;
	}

	/* The card floats as thick glass over the background gradient (ADR-0029 section 1). */
	.card {
		width: min(100%, 22rem);
		padding: 2rem;
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
		border: 1px solid var(--color-separator);
		border-radius: var(--radius-overlay);
		box-shadow:
			inset 0 1px 0 var(--glass-edge),
			var(--shadow-modal);
	}
</style>
