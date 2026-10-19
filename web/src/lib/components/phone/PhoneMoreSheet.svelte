<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import type { AreaView } from '$lib/domain/area';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { PHONE_MORE_VIEWS } from '$lib/domain/phone-layout';
	import { loginUrlFor } from '$lib/guard';
	import { CONTEXT_TEXTS } from '$lib/guidance/texts';
	import {
		groupSettingsSections,
		settingsSectionOf,
		settingsSubpageOf,
		visibleSettingsSections
	} from '$lib/settings-sections';
	import { appContext } from '$lib/stores/context.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import { findTrashStore } from '$lib/stores/trash.svelte';
	import { newTicketHref } from '$lib/ticket-links';
	import { VIEW_LABELS, viewHref } from '$lib/views';
	import Modal from '../overlay/Modal.svelte';
	import ViewIcon from '../ViewIcon.svelte';

	// "Mehr" of the bottom bar (MO-1a, ADR-0073): the modal as a sheet at the bottom, no new kind of
	// overlay. Nothing of the PC is gone, it is one level deeper: every view that is not in the bar,
	// in the fixed order of the navigation (ADR-0066 §1) with the same numbers; "Neues Ticket" with
	// every field; the pages of the settings in the groups and with the marks of their navigation
	// (the pages of the administrator "nur am PC" on another device, ADR-0057), so "Darstellung" and
	// "Hilfe" are here as well; the session. A link closes the sheet and leads there; ×, Esc and the
	// blanket close it, and the focus goes back to "Mehr".
	let {
		current,
		projectsNewCount = 0,
		onclose
	}: {
		/** The view shown, marked with aria-current; null in the settings. */
		current: AreaView | null;
		/** New tickets in projects (ADR-0015 section 5); 0 shows no number. */
		projectsNewCount?: number;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const trash = findTrashStore();
	const trashCount = $derived(trash?.count ?? null);
	const host = findHostStore();
	const groups = $derived(
		groupSettingsSections(
			visibleSettingsSections(
				host?.platform ?? DEFAULT_HOST_PLATFORM,
				appContext.capabilities.adminPages
			)
		)
	);
	const currentSection = $derived(
		settingsSubpageOf(page.url.pathname)?.parent ?? settingsSectionOf(page.url.pathname)?.id ?? null
	);

	// The same way out as the header of the PC: the login page with the current page as redirect.
	async function logout() {
		const target = loginUrlFor(page.url);
		onclose();
		auth.logout();
		await goto(target, { replaceState: true });
	}
</script>

<Modal open title="Mehr" placement="sheet" onclose={() => onclose()}>
	<nav class="group" aria-labelledby={`${uid}-views`} data-phone-frame="more">
		<h3 class="group-label" id={`${uid}-views`}>Ansichten</h3>
		<ul>
			{#each PHONE_MORE_VIEWS as view (view)}
				<li>
					<a
						href={viewHref(view, current, page.url)}
						aria-current={view === current ? 'page' : undefined}
						onclick={() => onclose()}
					>
						<ViewIcon {view} />
						<span class="name">{VIEW_LABELS[view]}</span>
						{#if view === 'projects' && projectsNewCount > 0}
							<span class="count"
								><span aria-hidden="true">{projectsNewCount}</span><span class="visually-hidden"
									>({projectsNewCount} neu)</span
								></span
							>
						{:else if view === 'trash' && trashCount !== null && trashCount > 0}
							<span class="count quiet"
								><span aria-hidden="true">{trashCount}</span><span class="visually-hidden"
									>({trashCount === 1 ? '1 Ticket' : `${trashCount} Tickets`})</span
								></span
							>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<section class="group" aria-labelledby={`${uid}-create`}>
		<h3 class="group-label" id={`${uid}-create`}>Anlegen</h3>
		<ul>
			<li>
				<a href={newTicketHref(page.url)} onclick={() => onclose()}>
					<svg class="symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d="M8 3v10M3 8h10" />
					</svg>
					<span class="name">Neues Ticket</span>
				</a>
			</li>
		</ul>
	</section>

	<nav class="group" aria-labelledby={`${uid}-settings`}>
		<h3 class="group-label" id={`${uid}-settings`}>Einstellungen</h3>
		{#each groups as group (group.id)}
			{#if group.label !== null}
				<p class="sub-label" id={`${uid}-${group.id}`}>
					{group.label}
					{#if group.pcOnly}
						<span class="mark">{CONTEXT_TEXTS.pcOnlyMark}</span>
					{/if}
				</p>
			{/if}
			<ul aria-labelledby={group.label === null ? undefined : `${uid}-${group.id}`}>
				{#each group.sections as section (section.id)}
					<li>
						<a
							href={section.href}
							aria-current={section.id === currentSection ? 'page' : undefined}
							onclick={() => onclose()}
						>
							<span class="name">{section.label}</span>
							{#if section.pcOnly}
								<span class="visually-hidden">{CONTEXT_TEXTS.pcOnlyMark}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>

	<div class="session">
		<p class="user">Angemeldet als <strong>{auth.email}</strong></p>
		<button class="button-secondary logout" type="button" onclick={logout}>Abmelden</button>
	</div>
</Modal>

<style>
	.group {
		display: grid;
		gap: 0.25rem;
	}

	/* The headings of the groups: quiet, like those of the settings navigation. */
	.group-label,
	.sub-label {
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.sub-label {
		margin-top: 0.5rem;
	}

	ul {
		display: grid;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* One row per target, as high as the target of the phone frame. */
	ul a {
		--view-icon-size: 1.25rem;
		display: flex;
		gap: 0.75rem;
		align-items: center;
		min-height: var(--phone-target);
		padding: 0 0.75rem;
		font-size: var(--font-size-body);
		color: var(--color-text);
		text-decoration: none;
		border-radius: var(--radius-control);
	}

	ul a:hover {
		background: var(--fill-control-hover);
	}

	/* The page shown: surface and weight, never colour alone. */
	ul a[aria-current='page'] {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	.symbol {
		flex: none;
		width: var(--view-icon-size);
		height: var(--view-icon-size);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	/* "nur am PC": quiet, after the name of the group, never instead of it. */
	.mark {
		margin-left: 0.5rem;
		font-weight: 400;
	}

	.count {
		min-width: 1.25rem;
		margin-left: auto;
		padding: 0 0.3125rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-pill);
	}

	/* The number of the trash is no call to act: muted, without the colour of "neu". */
	.count.quiet {
		color: var(--color-text-muted);
		background: none;
		border-color: var(--color-line);
	}

	.session {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-separator);
	}

	.user {
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.user strong {
		font-weight: 500;
		color: var(--color-text);
	}

	.logout {
		justify-self: start;
		min-height: var(--phone-target);
	}
</style>
