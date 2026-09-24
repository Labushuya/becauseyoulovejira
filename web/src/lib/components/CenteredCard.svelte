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

	.card {
		width: min(100%, 22rem);
		padding: 2rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.75rem;
	}
</style>
