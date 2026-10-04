<script lang="ts">
	import { tick } from 'svelte';
	import ActionsMenu, { type MenuAction } from '$lib/components/ActionsMenu.svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import {
		HOUSEHOLD_TEXTS,
		RIGHT_LABELS,
		leaveProblem,
		may,
		mayPurge,
		meOf,
		memberActions,
		memberLabel,
		membershipOf,
		nameProblem,
		problemText,
		type HouseholdMember,
		type HouseholdState
	} from '$lib/domain/household';
	import { retentionText } from '$lib/domain/trash';
	import { helpHref } from '$lib/settings-sections';
	import type { HouseholdStore } from '$lib/stores/household.svelte';
	import RetentionChoice from '../RetentionChoice.svelte';
	import HouseholdInvites from './HouseholdInvites.svelte';
	import HouseholdStart from './HouseholdStart.svelte';
	import MemberRightsDialog from './MemberRightsDialog.svelte';

	// Page "Einstellungen → Haushalt" (ADR-0058, E7-2) for every account on every device. Without a
	// household: found one or join with a code. With one: its name (rename with "rename"), the
	// members with role and rights (rights with "delegate", remove with "remove", hand on as owner,
	// each in the menu "•••" of the member), the codes with "invite", since E7-3 the retention of the
	// trash of the household ("purge", ADR-0059 §6) and "Austreten". What the server would refuse is
	// left out, not only disabled; removing, leaving and handing on ask first (no red, ADR-0009).
	// Refusals stand on the page; results go out as flags.
	let { store }: { store: HouseholdStore } = $props();

	type Question = { kind: 'remove' | 'transfer'; member: HouseholdMember } | { kind: 'leave' };

	const uid = $props.id();
	const ids = {
		title: `${uid}-title`,
		members: `${uid}-members`,
		leave: `${uid}-leave`,
		name: `${uid}-name`,
		nameError: `${uid}-name-error`
	};

	const current = $derived(store.household);
	let asking = $state<Question | null>(null);
	let rightsFor = $state<HouseholdMember | null>(null);
	let renaming = $state(false);
	let draft = $state('');
	let nameError = $state('');
	let nameInput = $state<HTMLInputElement>();
	let renameButton = $state<HTMLElement>();

	function itemsOf(state: HouseholdState, member: HouseholdMember): MenuAction[] {
		const allowed = memberActions(meOf(state), membershipOf(member));
		const locked = store.busy !== null;
		const busyHere =
			store.busy !== null && 'memberId' in store.busy && store.busy.memberId === member.id
				? store.busy.kind
				: null;
		const items: MenuAction[] = [];
		if (allowed.rights) {
			items.push({
				label: 'Rechte bearbeiten …',
				dialog: true,
				locked: locked && busyHere === null,
				busy: busyHere === 'rights',
				onselect: () => (rightsFor = member)
			});
		}
		if (allowed.transfer) {
			items.push({
				label: 'Zum Inhaber machen …',
				dialog: true,
				locked: locked && busyHere === null,
				busy: busyHere === 'transfer',
				onselect: () => (asking = { kind: 'transfer', member })
			});
		}
		if (allowed.remove) {
			items.push({
				label: 'Aus dem Haushalt entfernen …',
				dialog: true,
				separated: items.length > 0,
				locked: locked && busyHere === null,
				busy: busyHere === 'remove',
				onselect: () => (asking = { kind: 'remove', member })
			});
		}
		return items;
	}

	function rightsText(member: HouseholdMember): string {
		if (member.role === 'owner') return 'Alle Rechte';
		return member.rights.length === 0
			? 'Keine Sonderrechte'
			: member.rights.map((right) => RIGHT_LABELS[right]).join(', ');
	}

	const question = $derived.by(() => {
		if (asking === null) return null;
		if (asking.kind === 'leave') {
			const name = current?.household.name ?? '';
			return {
				title: HOUSEHOLD_TEXTS.leaveQuestion(name),
				text: HOUSEHOLD_TEXTS.leaveText,
				confirm: 'Austreten'
			};
		}
		const label = memberLabel(asking.member);
		return asking.kind === 'remove'
			? {
					title: HOUSEHOLD_TEXTS.removeQuestion(label),
					text: HOUSEHOLD_TEXTS.removeText(label),
					confirm: 'Entfernen'
				}
			: {
					title: HOUSEHOLD_TEXTS.transferQuestion(label),
					text: HOUSEHOLD_TEXTS.transferText,
					confirm: 'Zum Inhaber machen'
				};
	});

	async function confirmed() {
		const current = asking;
		asking = null;
		if (current === null) return;
		if (current.kind === 'leave') await store.leave();
		else if (current.kind === 'remove') await store.remove(current.member);
		else await store.transfer(current.member);
	}

	async function startRename(name: string) {
		draft = name;
		nameError = '';
		renaming = true;
		await tick();
		nameInput?.focus();
	}

	async function stopRename() {
		renaming = false;
		await tick();
		renameButton?.focus();
	}

	async function rename(event: SubmitEvent) {
		event.preventDefault();
		if (store.busy !== null) return;
		const problem = nameProblem(draft);
		if (problem !== '') {
			nameError = problemText(problem);
			nameInput?.focus();
			return;
		}
		const outcome = await store.rename(draft);
		if (outcome.ok) {
			await stopRename();
			return;
		}
		nameError = outcome.message;
		await tick();
		nameInput?.focus();
	}

	function renameKey(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		void stopRename();
	}
</script>

{#if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Haushalt wird geladen …</p>
{:else if store.state !== 'ready'}
	{#if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
		</SectionMessage>
	{/if}
{:else if current === null}
	<HouseholdStart {store} />
{:else}
	{@const state = current}
	{@const me = meOf(state)}
	<p class="intro">
		Was im Haushalt liegt, sehen und bearbeiten alle Mitglieder; Privates sieht nur sein Konto.
		<a href={helpHref('haushalt')}>Mehr zum Haushalt</a>
	</p>

	{#if store.message !== null}
		<SectionMessage tone="error" title={store.message.title} live>
			{store.message.text}
		</SectionMessage>
	{/if}

	<section class="part" aria-labelledby={ids.title}>
		<div class="title-row">
			<h3 id={ids.title}>{state.household.name}</h3>
			<Lozenge
				label={me.role === 'owner' ? 'Du bist Inhaber' : 'Du bist Mitglied'}
				icon={me.role === 'owner' ? 'check' : 'info'}
				tone={me.role === 'owner' ? 'brand' : 'neutral'}
			/>
		</div>
		{#if may(me, 'rename')}
			{#if renaming}
				<form
					class="rename"
					novalidate
					onsubmit={rename}
					aria-busy={store.busy?.kind === 'rename' ? 'true' : undefined}
				>
					<div class="field">
						<label class="label" for={ids.name}>Neuer Name</label>
						<input
							id={ids.name}
							type="text"
							autocomplete="off"
							maxlength="100"
							bind:this={nameInput}
							bind:value={draft}
							oninput={() => (nameError = '')}
							onkeydown={renameKey}
							aria-invalid={nameError === '' ? undefined : 'true'}
							aria-describedby={nameError === '' ? undefined : ids.nameError}
						/>
						{#if nameError !== ''}
							<p class="field-error" id={ids.nameError}><ErrorIcon /><span>{nameError}</span></p>
						{/if}
					</div>
					<div class="buttons">
						<button class="button-secondary" type="button" onclick={() => void stopRename()}>
							Abbrechen
						</button>
						<button
							class="button-primary"
							type="submit"
							aria-disabled={store.busy !== null ? 'true' : undefined}
							aria-busy={store.busy?.kind === 'rename' ? 'true' : undefined}
						>
							Speichern
						</button>
					</div>
				</form>
			{:else}
				<div>
					<button
						class="button-secondary"
						type="button"
						bind:this={renameButton}
						onclick={() => void startRename(state.household.name)}
					>
						Umbenennen …
					</button>
				</div>
			{/if}
		{/if}
	</section>

	<section class="part" aria-labelledby={ids.members}>
		<h3 id={ids.members}>Mitglieder</h3>
		<ul class="members">
			{#each state.members as member (member.id)}
				{@const label = memberLabel(member)}
				{@const items = itemsOf(state, member)}
				<li
					class="member"
					aria-busy={store.busy !== null &&
					'memberId' in store.busy &&
					store.busy.memberId === member.id
						? 'true'
						: undefined}
				>
					<div class="who">
						<span class="name">{label}</span>
						{#if member.self}<span class="self">(du)</span>{/if}
					</div>
					<div class="facts">
						{#if member.role === 'owner'}
							<Lozenge label="Inhaber" icon="check" tone="brand" />
						{:else}
							<span class="role">Mitglied</span>
						{/if}
						<span class="rights">{rightsText(member)}</span>
					</div>
					{#if items.length > 0}
						<div class="actions">
							<ActionsMenu
								label={`Aktionen für ${label}`}
								buttonLabel={`Weitere Aktionen für ${label}`}
								{items}
							/>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	{#if state.invites !== null}
		<HouseholdInvites {store} invites={state.invites} />
	{/if}

	<!-- Retention of the trash of the household (E7-3, ADR-0059 §6): the owner and the right
	     "purge" change it here, everybody else reads it. -->
	<section class="part">
		{#if mayPurge(me)}
			<RetentionChoice
				legend={HOUSEHOLD_TEXTS.retentionTitle}
				value={state.household.trashRetention}
				disabled={store.busy !== null}
				busy={store.busy?.kind === 'retention'}
				onchoose={(value) => void store.setRetention(value)}
			>
				{#snippet note()}
					{HOUSEHOLD_TEXTS.retentionText}
					{retentionText(state.household.trashRetention)}
				{/snippet}
			</RetentionChoice>
		{:else}
			<h3>{HOUSEHOLD_TEXTS.retentionTitle}</h3>
			<p class="note">
				{retentionText(state.household.trashRetention)}
				{HOUSEHOLD_TEXTS.retentionReadOnly}
			</p>
		{/if}
	</section>

	<section class="part" aria-labelledby={ids.leave}>
		<h3 id={ids.leave}>Haushalt verlassen</h3>
		{#if leaveProblem(me) === ''}
			<p class="note">
				Deine Einträge im Haushalt bleiben dort. Danach siehst du nur noch deine privaten Einträge.
			</p>
			<div>
				<button
					class="button-secondary"
					type="button"
					aria-haspopup="dialog"
					onclick={() => (asking = { kind: 'leave' })}
					aria-disabled={store.busy !== null ? 'true' : undefined}
					aria-busy={store.busy?.kind === 'leave' ? 'true' : undefined}
				>
					Austreten …
				</button>
			</div>
		{:else}
			<SectionMessage tone="info" compact>{HOUSEHOLD_TEXTS.ownerLeave}</SectionMessage>
		{/if}
	</section>

	{#if rightsFor !== null}
		<MemberRightsDialog
			member={rightsFor}
			actor={me}
			busy={store.busy?.kind === 'rights'}
			onsave={async (rights) => {
				const member = rightsFor;
				if (member !== null && (await store.setRights(member, rights))) rightsFor = null;
			}}
			onclose={() => (rightsFor = null)}
		/>
	{/if}
{/if}

<ConfirmDialog
	open={asking !== null}
	title={question?.title ?? ''}
	confirmLabel={question?.confirm ?? ''}
	onconfirm={() => void confirmed()}
	oncancel={() => (asking = null)}
>
	<p>{question?.text ?? ''}</p>
</ConfirmDialog>

<style>
	.intro,
	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.part {
		display: grid;
		gap: 0.625rem;
		margin-top: 1rem;
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.rename {
		display: grid;
		gap: 0.5rem;
		max-width: 32rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.members {
		display: grid;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--color-line);
	}

	.member {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		align-items: center;
		padding: 0.5rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	.who {
		display: flex;
		flex: 1 1 12rem;
		flex-wrap: wrap;
		gap: 0.125rem 0.5rem;
		align-items: baseline;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.name {
		font-weight: 600;
	}

	.self,
	.role,
	.rights {
		color: var(--color-text-muted);
	}

	.facts {
		display: flex;
		flex: 1 1 16rem;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
	}
</style>
