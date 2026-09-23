<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>becauseyoulovejira</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
