<script lang="ts">
	import { PIN_TOOLTIPS, pinToggleLabel } from '$lib/domain/pins';
	import type { Status } from '$lib/domain/status';
	import type { PinStore } from '$lib/stores/pins.svelte';
	import PinIcon from './PinIcon.svelte';

	// The pin toggle of a ticket (ADR-0064): a button with aria-pressed, the same name in both states
	// ("HAUS-12 anheften", APG "Button") and the tooltip of what a click does, „Anheften“ or „Lösen“.
	// In a row (`reveal`) it shows on pointing at the row and with the focus where a pointer can
	// hover (the row carries data-pin-row), always on touch screens and always for a pinned ticket;
	// it keeps its place, so nothing moves. A row keeps its height (the small control height), touch
	// screens get 44 px (ADR-0060). While the request runs it is busy and locked; a refusal comes as
	// a flag of the store. A done ticket offers no pinning; without the store (before the migration,
	// outside the app layout) there is no toggle. `onchanged` follows a successful click, so a list
	// can give the focus back to the toggle at the new place of the ticket.
	let {
		ticket,
		pins,
		variant = 'row',
		onchanged
	}: {
		ticket: { id: string; key: string; status: Status };
		pins: PinStore | null;
		/** "row" in lists (small, shown on pointing), "head" in the head of the detail. */
		variant?: 'row' | 'head';
		onchanged?: (ticketId: string) => void;
	} = $props();

	const pinned = $derived(pins?.isPinned(ticket.id) ?? false);
	const busy = $derived(pins?.isPending(ticket.id) ?? false);
	const shown = $derived(pins !== null && pins.available && (pinned || ticket.status !== 'done'));

	async function toggle() {
		if (pins === null || busy) return;
		const changed = await pins.toggle(ticket);
		if (changed) onchanged?.(ticket.id);
	}
</script>

{#if shown}
	<button
		class="button-icon pin-toggle {variant}"
		class:reveal={variant === 'row'}
		type="button"
		aria-label={pinToggleLabel(ticket.key)}
		aria-pressed={pinned}
		aria-busy={busy ? 'true' : undefined}
		aria-disabled={busy ? 'true' : undefined}
		title={pinned ? PIN_TOOLTIPS.unpin : PIN_TOOLTIPS.pin}
		data-pin-toggle={ticket.id}
		onclick={toggle}
	>
		<PinIcon filled={pinned} />
	</button>
{/if}

<style>
	.pin-toggle {
		flex: none;
	}

	/* In a row as high as the menu "•••" (.row-menu), so the row keeps its height. */
	.pin-toggle.row {
		width: var(--control-height-s);
		height: var(--control-height-s);
	}

	.pin-toggle[aria-pressed='true'] {
		color: var(--color-brand-text);
	}

	/* Where a pointer can hover: shown on pointing at the row and with the focus; pinned always. */
	@media (hover: hover) {
		.reveal {
			opacity: 0;
		}

		.reveal[aria-pressed='true'],
		.reveal:focus-visible,
		:global([data-pin-row]:hover) .reveal,
		:global([data-pin-row]:focus-within) .reveal {
			opacity: 1;
		}
	}

	/* Touch screens (ADR-0060): 44 px. */
	@media (pointer: coarse) {
		.pin-toggle,
		.pin-toggle.row {
			width: var(--control-height-touch);
			height: var(--control-height-touch);
		}
	}
</style>
