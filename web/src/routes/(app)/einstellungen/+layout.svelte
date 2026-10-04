<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import Breadcrumbs from '$lib/components/Breadcrumbs.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import ViewSwitch from '$lib/components/ViewSwitch.svelte';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import {
		SETTINGS_HOME,
		isSettingsPath,
		settingsSectionOf,
		visibleSettingsSections
	} from '$lib/settings-sections';
	import { findHostStore } from '$lib/stores/host.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getLastViewStore, lastViewLabel } from '$lib/stores/last-view.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';

	// Settings area (ADR-0026 section 1, plan EH-1): the switch "Aufgaben | Projekte | Eingang" at
	// its place below the header, with no entry current; then the navigation with the way back on
	// the left and the page on the right, with breadcrumbs and its heading. Same width and margins
	// as the views (user decision): no maximum width, not pushed to the left. After a change of the
	// page the focus goes to the heading, like the section bar of the views.
	let { children } = $props();

	const tickets = getTicketListStore();
	const inbox = getInboxStore();
	const lastView = getLastViewStore();
	// "System" only for a server on Windows (ADR-0043); until the answer and outside the app layout
	// the server counts as Windows, like the guides. The pages of the administrator only for the
	// administrator of the app (ADR-0056 §7).
	const host = findHostStore();
	const sections = $derived(
		visibleSettingsSections(host?.platform ?? DEFAULT_HOST_PLATFORM, auth.isAdmin)
	);

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	const section = $derived(settingsSectionOf(page.url.pathname));
	const title = $derived(section?.label ?? 'Einstellungen');
	const backHref = $derived(lastView.href);
	const backLabel = $derived(lastViewLabel(backHref, (id) => tickets.find(id)?.key ?? null));

	let heading = $state<HTMLElement>();

	afterNavigate(({ from, to }) => {
		if (!from || !to || from.url.pathname === to.url.pathname) return;
		if (isSettingsPath(from.url.pathname)) heading?.focus();
	});
</script>

<div class="settings-bar">
	<ViewSwitch current={null} inboxCount={inbox.newCount} projectsNewCount={tickets.newInProjects} />
</div>

<div class="settings">
	<div class="nav-column">
		<SettingsNav {sections} current={section?.id ?? null} {backHref} {backLabel} />
	</div>
	<div class="page">
		<Breadcrumbs items={[{ label: 'Einstellungen', href: SETTINGS_HOME }, { label: title }]} />
		<h2 id={headingId} tabindex="-1" data-view-heading bind:this={heading}>{title}</h2>
		{@render children()}
	</div>
</div>

<style>
	.settings-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		align-items: center;
		margin-bottom: 1.25rem;
	}

	.settings {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
	}

	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		align-content: start;
		min-width: 0;
	}

	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	h2:focus {
		outline: none;
	}

	h2:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	/* Running text keeps a readable line length; cards and grids use the full width. */
	.page :global(p) {
		max-width: 80ch;
	}

	/* From 64rem the navigation is a column on the left that stays below the fixed header. */
	@media (min-width: 64rem) {
		.settings {
			grid-template-columns: 15rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}

		.nav-column {
			position: sticky;
			top: calc(var(--app-header-height, 0px) + 1rem);
		}
	}
</style>
