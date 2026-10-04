<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from '$lib/components/overlay/Modal.svelte';
	import {
		RIGHT_HINTS,
		RIGHT_LABELS,
		RIGHTS,
		delegableRights,
		memberLabel,
		type HouseholdMember,
		type HouseholdRight,
		type Membership
	} from '$lib/domain/household';

	// "Rechte bearbeiten" (ADR-0058 §4): only the rights the signed-in account holds itself stand as
	// checkboxes (no way to more rights); rights of the member that the account cannot change are
	// named below and stay as they are. Saves all at once; the server checks the same. The owner
	// mounts the dialog for one member at a time, so the choice starts from the rights of that member.
	let {
		member,
		actor,
		busy,
		onsave,
		onclose
	}: {
		member: HouseholdMember;
		actor: Membership;
		busy: boolean;
		onsave: (rights: HouseholdRight[]) => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const delegable = $derived(delegableRights(actor));
	let chosen = $state<HouseholdRight[]>(untrack(() => [...member.rights]));

	const foreign = $derived(member.rights.filter((right) => !delegable.includes(right)));
	const dirty = $derived(
		RIGHTS.some((right) => member.rights.includes(right) !== chosen.includes(right))
	);

	function toggle(right: HouseholdRight, on: boolean) {
		chosen = on ? [...chosen, right] : chosen.filter((entry) => entry !== right);
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		onsave(RIGHTS.filter((right) => chosen.includes(right)));
	}
</script>

<Modal open size="m" title={`Rechte von ${memberLabel(member)}`} {busy} {dirty} {onclose}>
	<form id={formId} novalidate onsubmit={save}>
		<fieldset>
			<legend>Rechte, die du weitergeben kannst</legend>
			{#each delegable as right (right)}
				<label class="choice">
					<input
						type="checkbox"
						checked={chosen.includes(right)}
						onchange={(event) => toggle(right, event.currentTarget.checked)}
						aria-describedby={`${uid}-${right}-hint`}
					/>
					<span class="text">
						<span class="name">{RIGHT_LABELS[right]}</span>
						<span class="hint" id={`${uid}-${right}-hint`}>{RIGHT_HINTS[right]}</span>
					</span>
				</label>
			{/each}
		</fieldset>
		{#if foreign.length > 0}
			<p class="note">
				Weitere Rechte von {memberLabel(member)}, die du nicht ändern kannst:
				{foreign.map((right) => RIGHT_LABELS[right]).join(', ')}.
			</p>
		{/if}
	</form>
	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={busy ? 'true' : undefined}
			aria-busy={busy ? 'true' : undefined}
		>
			Speichern
		</button>
	{/snippet}
</Modal>

<style>
	form {
		display: grid;
		gap: 0.75rem;
	}

	fieldset {
		display: grid;
		gap: 0.625rem;
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.5rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.choice {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.text {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}

	.name {
		font-size: var(--font-size-body);
	}

	.hint,
	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
