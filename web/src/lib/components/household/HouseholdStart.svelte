<script lang="ts">
	import { tick } from 'svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import { groupCodeInput, nameProblem, problemText } from '$lib/domain/household';
	import type { HouseholdStore } from '$lib/stores/household.svelte';

	// Without a household (ADR-0058 §1, §2): "Haushalt gründen" with a name, or "Mit Code beitreten"
	// with the code of a member. The code is grouped while it is typed ("ABCD-EFGH"); case and hyphen
	// do not count. Every unknown or ended code gets the same text at the field (the server never
	// says which case it is), too many attempts the hint to wait. Errors stay at their field
	// (ADR-0009).
	let { store }: { store: HouseholdStore } = $props();

	const uid = $props.id();
	const ids = {
		found: `${uid}-found`,
		name: `${uid}-name`,
		nameError: `${uid}-name-error`,
		join: `${uid}-join`,
		code: `${uid}-code`,
		codeError: `${uid}-code-error`,
		codeHint: `${uid}-code-hint`
	};

	let name = $state('');
	let nameError = $state('');
	let code = $state('');
	let codeError = $state('');
	let nameInput = $state<HTMLInputElement>();
	let codeInput = $state<HTMLInputElement>();

	const founding = $derived(store.busy?.kind === 'found');
	const joining = $derived(store.busy?.kind === 'join');

	async function found(event: SubmitEvent) {
		event.preventDefault();
		if (store.busy !== null) return;
		const problem = nameProblem(name);
		if (problem !== '') {
			nameError = problemText(problem);
			nameInput?.focus();
			return;
		}
		const outcome = await store.found(name);
		if (outcome.ok) return;
		nameError = outcome.message;
		await tick();
		nameInput?.focus();
	}

	async function join(event: SubmitEvent) {
		event.preventDefault();
		if (store.busy !== null) return;
		const outcome = await store.join(code);
		if (outcome.ok) return;
		codeError = outcome.message;
		await tick();
		codeInput?.focus();
	}

	function typed(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const grouped = groupCodeInput(input.value, input.selectionStart ?? input.value.length);
		code = grouped.value;
		input.value = grouped.value;
		input.setSelectionRange(grouped.caret, grouped.caret);
		codeError = '';
	}
</script>

<p class="intro">
	Ein Haushalt ist ein gemeinsamer Bereich für Tickets, Projekte und Wiederholungen. Ein Konto kann
	vorerst in einem Haushalt sein.
</p>

<div class="ways">
	<section class="way" aria-labelledby={ids.found}>
		<h3 id={ids.found}>Haushalt gründen</h3>
		<p class="note">Du wirst Inhaber und lädst andere mit einem Code ein.</p>
		<form novalidate onsubmit={found} aria-busy={founding ? 'true' : undefined}>
			<div class="field">
				<label class="label" for={ids.name}>Name des Haushalts</label>
				<input
					id={ids.name}
					type="text"
					autocomplete="off"
					maxlength="100"
					bind:this={nameInput}
					bind:value={name}
					oninput={() => (nameError = '')}
					aria-invalid={nameError === '' ? undefined : 'true'}
					aria-describedby={nameError === '' ? undefined : ids.nameError}
				/>
				{#if nameError !== ''}
					<p class="field-error" id={ids.nameError}><ErrorIcon /><span>{nameError}</span></p>
				{/if}
			</div>
			<div>
				<button
					class="button-primary"
					type="submit"
					aria-disabled={store.busy !== null ? 'true' : undefined}
					aria-busy={founding ? 'true' : undefined}
				>
					Haushalt gründen
				</button>
			</div>
		</form>
	</section>

	<section class="way" aria-labelledby={ids.join}>
		<h3 id={ids.join}>Mit Code beitreten</h3>
		<p class="note">Den Code bekommst du von einem Mitglied des Haushalts.</p>
		<form novalidate onsubmit={join} aria-busy={joining ? 'true' : undefined}>
			<div class="field">
				<label class="label" for={ids.code}>Einladungscode</label>
				<input
					id={ids.code}
					class="code"
					type="text"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					placeholder="ABCD-EFGH"
					bind:this={codeInput}
					value={code}
					oninput={typed}
					aria-invalid={codeError === '' ? undefined : 'true'}
					aria-describedby={codeError === '' ? ids.codeHint : `${ids.codeError} ${ids.codeHint}`}
				/>
				{#if codeError !== ''}
					<p class="field-error" id={ids.codeError}><ErrorIcon /><span>{codeError}</span></p>
				{/if}
				<p class="hint" id={ids.codeHint}>
					8 Zeichen; Groß- und Kleinschreibung und Bindestrich sind egal.
				</p>
			</div>
			<div>
				<button
					class="button-primary"
					type="submit"
					aria-disabled={store.busy !== null ? 'true' : undefined}
					aria-busy={joining ? 'true' : undefined}
				>
					Beitreten
				</button>
			</div>
		</form>
	</section>
</div>

<style>
	.intro,
	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.ways {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	.way {
		display: grid;
		gap: 0.625rem;
		align-content: start;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	form {
		display: grid;
		gap: 0.75rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.code {
		font-family: var(--font-mono);
		letter-spacing: 0.05em;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
