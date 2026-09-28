<script lang="ts">
	import { untrack } from 'svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';

	// Test harness of RichTextEditor (rich-text-editor.test.ts): holds the bound value, shows it in
	// an output and lets the test set it from outside like a store would.
	let {
		initial = '',
		compact = false,
		maxlength = 1000,
		onsubmit
	}: {
		initial?: string;
		compact?: boolean;
		maxlength?: number;
		onsubmit?: () => void;
	} = $props();

	let value = $state(untrack(() => initial));
	let editor = $state<ReturnType<typeof RichTextEditor>>();

	/** A new value from outside (a sent comment, a discarded draft). */
	export function setValue(next: string): void {
		value = next;
	}

	export function focus(): void {
		editor?.focus();
	}

	export function current(): string {
		return value;
	}
</script>

<RichTextEditor
	bind:this={editor}
	bind:value
	label="Beschreibung"
	placeholder="Beschreibung eingeben …"
	{maxlength}
	{compact}
	{onsubmit}
/>
<button type="button">Danach</button>
