<script lang="ts">
	import ErrorIcon from './ErrorIcon.svelte';

	// The switch "Blockiert das übergeordnete Ticket" of a sub-task (ADR-0033 section 2): while the
	// sub-task is open, completing its parent asks first. One building block for the row "Übergeordnet"
	// of a ticket (it saves at once there) and "Neues Ticket" (NT-1, part of the request there). After a
	// change the switch shows `blocks` again, so a refusal of the owner sets it back.
	let {
		blocks,
		parentKey,
		busy = false,
		error = null,
		onchange
	}: {
		blocks: boolean;
		/** Key of the parent for the hint ("HAUS-12"). */
		parentKey: string;
		busy?: boolean;
		error?: string | null;
		onchange: (blocks: boolean) => void | Promise<unknown>;
	} = $props();

	const uid = $props.id();
	const ids = { hint: `${uid}-hint`, error: `${uid}-error` };

	async function change(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		await onchange(input.checked);
		input.checked = blocks;
	}
</script>

<label class="switch-row">
	<span>Blockiert das übergeordnete Ticket</span>
	<input
		type="checkbox"
		role="switch"
		checked={blocks}
		aria-busy={busy ? 'true' : undefined}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
		onchange={change}
	/>
</label>
<p class="hint" id={ids.hint}>
	{blocks
		? `Solange diese Unteraufgabe offen ist, fragt das Erledigen von ${parentKey} nach.`
		: `${parentKey} lässt sich erledigen, auch wenn diese Unteraufgabe offen ist.`}
</p>
{#if error}
	<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
{/if}

<style>
	/* Name left, switch right, like "Glas-Effekt" (ADR-0029, G-5). */
	.switch-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.25rem;
		cursor: pointer;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
