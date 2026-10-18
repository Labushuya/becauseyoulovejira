<script lang="ts">
	import { LIST_ORDERS, LIST_ORDER_LABELS, type ListOrder } from '$lib/domain/list-order';

	// The switch "Neueste zuerst | Älteste zuerst" of a list by time (ADR-0044 §1; since QS-1 also
	// for the sources of a ticket, ADR-0031 addendum M): a group of two buttons with aria-pressed in
	// the shared segment style. The owner remembers the choice and says it in its own live region,
	// because only it knows the noun ("Älteste Kommentare zuerst.").
	let {
		label,
		order,
		onchange
	}: {
		/** Name of the group, e.g. "Reihenfolge der Kommentare". */
		label: string;
		/** The chosen order. */
		order: ListOrder;
		/** Called with the other order; pressing the chosen one does nothing. */
		onchange: (order: ListOrder) => void;
	} = $props();
</script>

<div class="order segmented" role="group" aria-label={label}>
	{#each LIST_ORDERS as choice (choice)}
		<button
			type="button"
			aria-pressed={order === choice}
			onclick={() => {
				if (choice !== order) onchange(choice);
			}}
		>
			{LIST_ORDER_LABELS[choice]}
		</button>
	{/each}
</div>

<style>
	.order {
		justify-self: end;
	}
</style>
