<script lang="ts">
	import { tick } from 'svelte';
	import {
		ASSIGNEES_MAX,
		ASSIGNEE_MODE_LABELS,
		assigneeName,
		rotationPreviewText,
		type AssigneeContext,
		type AssigneeMode,
		type FormAssignment
	} from '$lib/domain/assignee';
	import type { AssigneeChoice } from '$lib/stores/assignees.svelte';
	import ErrorIcon from './ErrorIcon.svelte';

	// "Zuständigkeit" of the next tickets of a rule of the household (E7-5, ADR-0068 §5): "Keine",
	// "Fest" (one person, a native select) or "Abwechselnd" (an ordered list of members: added from a
	// native select, moved and removed with named buttons, so keyboard and screen readers reach every
	// step; a polite status says what happened). The list starts with the person of the next
	// occurrence; the preview below names the next two ("Nächstes Vorkommen: Anna, danach: Bert"). The
	// value is replaced as a whole on every change, so a binding through getter and setter works.
	let {
		value = $bindable(),
		members,
		context,
		error = null,
		errorId
	}: {
		/** Undefined counts as "Keine" until the first change. */
		value: FormAssignment | undefined;
		/** The members of the household, the own account first. */
		members: readonly AssigneeChoice[];
		context: AssigneeContext;
		error?: string | null;
		errorId: string;
	} = $props();

	const uid = $props.id();
	const ids = {
		legend: `${uid}-legend`,
		fixed: `${uid}-fixed`,
		add: `${uid}-add`,
		preview: `${uid}-preview`,
		hint: `${uid}-hint`
	};
	const MODES: readonly (AssigneeMode | '')[] = ['', 'fixed', 'rotate'];

	const current = $derived<FormAssignment>(value ?? { mode: '', assignees: [] });
	const people = $derived(current.assignees);
	const nameOf = (id: string) => {
		const member = members.find((entry) => entry.id === id);
		return member ? member.name : assigneeName(id, context);
	};
	/** Members not in the rotation yet, for "Person hinzufügen". */
	const addable = $derived(members.filter((member) => !people.includes(member.id)));
	const full = $derived(people.length >= ASSIGNEES_MAX);
	const preview = $derived.by(() => {
		const shown = current.mode === 'fixed' ? people.slice(0, 1) : people;
		return current.mode === '' ? '' : rotationPreviewText(shown.map(nameOf), current.mode);
	});

	let toAdd = $state('');
	let status = $state('');
	let list = $state<HTMLOListElement>();
	let addSelect = $state<HTMLSelectElement>();

	function set(next: FormAssignment) {
		value = { mode: next.mode, assignees: [...next.assignees] };
	}

	function chooseMode(mode: AssigneeMode | '') {
		// "Fest" starts with the first person of a rotation, or the own account.
		if (mode === 'fixed' && people.length === 0) {
			const self = members.find((member) => member.self) ?? members[0];
			set({ mode, assignees: self ? [self.id] : [] });
			return;
		}
		set({ mode, assignees: mode === '' ? [] : people });
	}

	function chooseFixed(id: string) {
		set({
			mode: 'fixed',
			assignees: id === '' ? [] : [id, ...people.filter((entry) => entry !== id)]
		});
	}

	async function add() {
		const id = toAdd === '' ? (addable[0]?.id ?? '') : toAdd;
		if (id === '' || full || people.includes(id)) return;
		set({ mode: 'rotate', assignees: [...people, id] });
		status = `${nameOf(id)} an Position ${people.length} hinzugefügt.`;
		toAdd = '';
		await tick();
		addSelect?.focus();
	}

	function rowButton(index: number, part: 'up' | 'down' | 'remove'): HTMLElement | null {
		return list?.querySelectorAll<HTMLElement>(`[data-row-part="${part}"]`)[index] ?? null;
	}

	async function move(index: number, to: number) {
		if (to < 0 || to >= people.length) return;
		const next = [...people];
		const [moved] = next.splice(index, 1);
		if (moved === undefined) return;
		next.splice(to, 0, moved);
		set({ mode: 'rotate', assignees: next });
		status = `${nameOf(moved)} an Position ${to + 1} von ${next.length} verschoben.`;
		await tick();
		const same = to < index ? 'up' : 'down';
		const canGoOn = same === 'up' ? to > 0 : to < next.length - 1;
		rowButton(to, canGoOn ? same : same === 'up' ? 'down' : 'up')?.focus();
	}

	async function remove(index: number) {
		const id = people[index];
		if (id === undefined) return;
		set({ mode: 'rotate', assignees: people.filter((_entry, position) => position !== index) });
		status = `${nameOf(id)} entfernt.`;
		await tick();
		const next = Math.min(index, people.length - 1);
		(next >= 0 ? rowButton(next, 'remove') : addSelect)?.focus();
	}
</script>

<fieldset
	class="assignment"
	aria-describedby={[error ? errorId : '', ids.hint].filter((part) => part !== '').join(' ')}
>
	<legend id={ids.legend}>Zuständigkeit</legend>
	<p class="hint" id={ids.hint}>
		Jedes neue Ticket der Serie bekommt seine zuständige Person; „Abwechselnd“ geht der Reihe nach
		reihum.
	</p>
	<div class="modes">
		{#each MODES as mode (mode)}
			<label class="choice">
				<input
					type="radio"
					name={`${uid}-mode`}
					value={mode}
					checked={current.mode === mode}
					onchange={() => chooseMode(mode)}
				/>
				{ASSIGNEE_MODE_LABELS[mode]}
			</label>
		{/each}
	</div>

	{#if current.mode === 'fixed'}
		<div class="field">
			<label for={ids.fixed}>Person</label>
			<select
				id={ids.fixed}
				value={people[0] ?? ''}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? errorId : undefined}
				onchange={(event) => chooseFixed(event.currentTarget.value)}
			>
				<option value="" disabled>Bitte wählen</option>
				{#each members as member (member.id)}
					<option value={member.id}>{member.self ? `${member.name} (ich)` : member.name}</option>
				{/each}
			</select>
		</div>
	{:else if current.mode === 'rotate'}
		{#if people.length > 0}
			<ol class="list" aria-labelledby={ids.legend} bind:this={list}>
				{#each people as id, index (id)}
					<li class="row">
						<span class="position" aria-hidden="true">{index + 1}.</span>
						<span class="name">{nameOf(id)}</span>
						<span class="moves">
							<button
								class="button-icon"
								type="button"
								data-row-part="up"
								aria-label={`${nameOf(id)} nach oben verschieben`}
								title="Nach oben verschieben"
								aria-disabled={index === 0 ? 'true' : undefined}
								onclick={() => void move(index, index - 1)}
							>
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M8 13V3M4 7l4-4 4 4" />
								</svg>
							</button>
							<button
								class="button-icon"
								type="button"
								data-row-part="down"
								aria-label={`${nameOf(id)} nach unten verschieben`}
								title="Nach unten verschieben"
								aria-disabled={index === people.length - 1 ? 'true' : undefined}
								onclick={() => void move(index, index + 1)}
							>
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M8 3v10M4 9l4 4 4-4" />
								</svg>
							</button>
							<button
								class="button-icon"
								type="button"
								data-row-part="remove"
								aria-label={`${nameOf(id)} entfernen`}
								title="Aus der Reihenfolge entfernen"
								onclick={() => void remove(index)}
							>
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M4 4l8 8M12 4l-8 8" />
								</svg>
							</button>
						</span>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="muted">Noch niemand in der Reihenfolge.</p>
		{/if}
		{#if addable.length > 0 && !full}
			<div class="add">
				<label class="visually-hidden" for={ids.add}>Person hinzufügen</label>
				<select id={ids.add} bind:value={toAdd} bind:this={addSelect}>
					{#each addable as member (member.id)}
						<option value={member.id}>{member.self ? `${member.name} (ich)` : member.name}</option>
					{/each}
				</select>
				<button class="button-secondary button-small" type="button" onclick={() => void add()}>
					Hinzufügen
				</button>
			</div>
		{/if}
	{/if}

	{#if preview !== ''}
		<p class="preview" id={ids.preview}>{preview}</p>
	{/if}
	{#if error}
		<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
	{/if}
	<p class="visually-hidden" aria-live="polite">{status}</p>
</fieldset>

<style>
	.assignment {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.hint,
	.muted {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.modes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
	}

	.choice {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		cursor: pointer;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.field select,
	.add select {
		width: fit-content;
		max-width: 100%;
	}

	.list {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
	}

	.position {
		flex: none;
		min-width: 1.5rem;
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.name {
		flex: 1 1 8rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.moves {
		display: inline-flex;
		flex: none;
	}

	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.preview {
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text);
	}
</style>
