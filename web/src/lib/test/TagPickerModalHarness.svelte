<script lang="ts">
	import TagPicker from '$lib/components/TagPicker.svelte';
	import Modal from '$lib/components/overlay/Modal.svelte';
	import type { CloseTrigger } from '$lib/overlay/close-rules';
	import type { TagRef } from '$lib/domain/ticket';

	// Test harness for the tag picker inside a modal (tag-picker.test.ts, package UI-9), as in
	// "Gesammelt umwandeln": the list of suggestions opens in the top layer from within the dialog,
	// and Escape in the picker must not close the modal while the picker consumes it.
	let {
		tags,
		onreason = () => undefined
	}: { tags: readonly TagRef[]; onreason?: (reason: CloseTrigger) => void } = $props();

	let open = $state(true);
	let selected = $state<TagRef[]>([]);
</script>

<Modal
	{open}
	title="Gesammelt umwandeln"
	onclose={(reason) => {
		onreason(reason);
		open = false;
	}}
>
	<label for="modal-tags">Tags</label>
	<TagPicker
		id="modal-tags"
		{selected}
		{tags}
		errorId="modal-tags-error"
		onadd={(id) => {
			const tag = tags.find((candidate) => candidate.id === id);
			if (tag) selected = [...selected, tag];
			return true;
		}}
		onremove={(id) => {
			selected = selected.filter((tag) => tag.id !== id);
			return true;
		}}
		oncreate={() => true}
	/>
</Modal>
