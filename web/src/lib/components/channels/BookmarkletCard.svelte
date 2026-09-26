<script lang="ts">
	import { bookmarkletCode } from '$lib/domain/bookmarklet';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ChannelIcon from './ChannelIcon.svelte';

	// Card "Web-Links per Bookmarklet" (ADR-0026 section 6, plan EH-4 and §3.6): a designed card with
	// a draggable knob instead of a bare text link. A small own illustration shows a copy of the knob
	// gliding onto the bookmarks bar: twice when the card first becomes visible, then once on hover
	// or focus of the knob; with reduced motion a static dashed arrow instead. A click on the knob
	// does nothing and says why; the way without a mouse is the code in a folded CodeBlock.
	let { captureUrl }: { captureUrl: string } = $props();

	const uid = $props.id();
	const ids = { heading: `${uid}-heading`, drag: `${uid}-drag` };
	/** Query of reduced motion; the CSS media query below says the same without script. */
	const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

	const code = $derived(bookmarkletCode(captureUrl));

	let figure = $state<HTMLElement>();
	let reduced = $state(false);
	/** Runs of the animation: 2 when first visible, 1 on hover or focus, 0 while still. */
	let runs = $state(0);
	/** Restarts the animation when it is played again. */
	let playId = $state(0);
	let dragging = $state(false);
	let clicked = $state(false);

	function play(count: number) {
		if (reduced || runs > 0) return;
		runs = count;
		playId += 1;
	}

	// Reduced motion follows the system while the card is shown.
	$effect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const query = window.matchMedia(REDUCED_MOTION);
		reduced = query.matches;
		const onchange = () => (reduced = query.matches);
		query.addEventListener?.('change', onchange);
		return () => query.removeEventListener?.('change', onchange);
	});

	// Twice when the card first becomes visible; without IntersectionObserver it stays still.
	$effect(() => {
		const target = figure;
		if (!target || typeof IntersectionObserver !== 'function') return;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			play(2);
		});
		observer.observe(target);
		return () => observer.disconnect();
	});
</script>

<section class="card" aria-labelledby={ids.heading}>
	<div class="head">
		<ChannelIcon kind="bookmarklet" />
		<div>
			<h4 id={ids.heading}>Web-Links per Bookmarklet</h4>
			<p class="lead">Bringt die offene Webseite mit einem Klick in den Eingang.</p>
		</div>
	</div>

	<div class="illustration" class:dragging bind:this={figure} aria-hidden="true">
		<svg viewBox="0 0 280 96" width="280" height="96" focusable="false">
			<rect class="window" x="4" y="4" width="272" height="88" rx="6" />
			<rect class="address" x="44" y="10" width="170" height="9" rx="4.5" />
			<circle class="dot" cx="16" cy="14.5" r="2.5" />
			<circle class="dot" cx="25" cy="14.5" r="2.5" />
			<line class="rule" x1="4" y1="24" x2="276" y2="24" />
			<rect class="mark" x="14" y="28" width="30" height="7" rx="3.5" />
			<rect class="mark" x="50" y="28" width="38" height="7" rx="3.5" />
			<rect class="slot" x="110" y="27" width="60" height="9" rx="4.5" />
			<line class="rule" x1="4" y1="40" x2="276" y2="40" />
			<g class="knob">
				<rect x="110" y="62" width="60" height="18" rx="9" />
				<path d="M120 67.5v7M124 67.5v7" />
			</g>
			{#if reduced}
				<path class="arrow" d="M170 66c22-6 22-24 4-29M170 33l4 4-5 3" />
			{:else}
				{#key playId}
					<g
						class="ghost"
						class:playing={runs > 0}
						style:animation-iteration-count={runs > 0 ? runs : undefined}
						onanimationend={() => (runs = 0)}
					>
						<rect x="110" y="62" width="60" height="18" rx="9" />
					</g>
				{/key}
				<path class="arrow still" d="M170 66c22-6 22-24 4-29M170 33l4 4-5 3" />
			{/if}
		</svg>
		{#if dragging}
			<p class="drop">Loslassen auf der Lesezeichenleiste</p>
		{/if}
	</div>

	<p class="knob-row">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- the bookmarklet itself: a javascript: address meant for the bookmarks bar, not for navigation here -->
		<a
			class="bookmarklet"
			href={code}
			draggable="true"
			aria-describedby={ids.drag}
			onclick={(event) => {
				event.preventDefault();
				clicked = true;
			}}
			ondragstart={() => (dragging = true)}
			ondragend={() => (dragging = false)}
			onmouseenter={() => play(1)}
			onfocus={() => play(1)}
		>
			<svg
				class="grip"
				viewBox="0 0 16 16"
				width="14"
				height="14"
				aria-hidden="true"
				focusable="false"
			>
				<circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" /><circle
					cx="6"
					cy="8"
					r="1.1"
				/><circle cx="10" cy="8" r="1.1" /><circle cx="6" cy="12" r="1.1" /><circle
					cx="10"
					cy="12"
					r="1.1"
				/>
			</svg>
			In den Eingang
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</p>
	<p class="hint" id={ids.drag}>
		Ziehe diesen Knopf auf deine Lesezeichenleiste (Strg+Umschalt+B blendet sie ein).
	</p>
	{#if clicked}
		<SectionMessage tone="info" compact live>
			Ziehen statt klicken: Der Knopf gehört auf die Lesezeichenleiste.
		</SectionMessage>
	{/if}

	<ol class="steps">
		<li>Lesezeichenleiste einblenden (Strg+Umschalt+B).</li>
		<li>Den Knopf „In den Eingang“ mit der Maus auf die Leiste ziehen.</li>
		<li>
			Auf einer Webseite das Lesezeichen anklicken, im neuen Tab prüfen und „In den Eingang“ wählen.
			Gespeichert wird erst, wenn du dort auf „In den Eingang“ klickst; ist die App nicht
			angemeldet, geht es nach der Anmeldung weiter.
		</li>
	</ol>

	<details class="keyboard">
		<summary>Ohne Maus einrichten</summary>
		<div class="keyboard-body">
			<ol class="steps">
				<li>Ein neues Lesezeichen anlegen (Strg+D, dann „Bearbeiten“ bzw. „Mehr“).</li>
				<li>
					Den Code unten kopieren und als Adresse des Lesezeichens einfügen, Name „In den Eingang“.
				</li>
			</ol>
			<CodeBlock {code} label="Code des Bookmarklets" wrap />
		</div>
	</details>

	<SectionMessage tone="info" compact>
		Nur http- und https-Seiten. Dieselbe Seite ein zweites Mal meldet, dass sie schon im Eingang
		ist.
	</SectionMessage>
</section>

<style>
	.card {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.625rem;
		align-items: flex-start;
	}

	h4 {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.lead,
	.steps {
		font-size: 0.875rem;
	}

	.lead {
		color: var(--color-text-muted);
	}

	/* Illustration: own drawing with the tokens, no image file. */
	.illustration {
		position: relative;
		max-width: 100%;
		overflow: hidden;
	}

	.illustration svg {
		display: block;
		max-width: 100%;
		height: auto;
	}

	.window {
		fill: var(--color-bg);
		stroke: var(--color-line);
	}

	.address,
	.mark {
		fill: var(--color-surface);
		stroke: var(--color-line);
	}

	.dot {
		fill: var(--color-line);
	}

	.rule {
		stroke: var(--color-line);
	}

	.slot {
		fill: none;
		stroke: var(--color-brand);
		stroke-dasharray: 3 2;
	}

	.knob rect,
	.ghost rect {
		fill: var(--color-brand-soft-bg);
		stroke: var(--color-brand);
	}

	.knob path {
		stroke: var(--color-brand-soft-text);
		stroke-linecap: round;
	}

	.ghost {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
	}

	.ghost.playing {
		animation: glide 1.8s var(--motion-ease) both;
	}

	/* An arc from the knob up onto the free place of the bookmarks bar, where it settles. */
	@keyframes glide {
		0% {
			opacity: 0;
			transform: translate(0, 0) scale(1);
		}

		15% {
			opacity: 1;
		}

		55% {
			transform: translate(22px, -24px) scale(0.95);
		}

		85% {
			opacity: 1;
			transform: translate(0, -35px) scale(0.9);
		}

		100% {
			opacity: 0;
			transform: translate(0, -35px) scale(0.9);
		}
	}

	.arrow {
		fill: none;
		stroke: var(--color-brand);
		stroke-dasharray: 3 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* The dashed arrow only stands where the motion is off. */
	.arrow.still {
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.ghost {
			display: none;
		}

		.arrow.still {
			display: inline;
		}
	}

	.drop {
		position: absolute;
		top: 0.25rem;
		left: 50%;
		padding: 0 0.5rem;
		font-size: 0.75rem;
		color: var(--color-brand-soft-text);
		white-space: nowrap;
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: 999px;
		transform: translateX(-50%);
	}

	.dragging .window {
		stroke: var(--color-brand);
	}

	/* The draggable knob: a pill with a grip, brand surface, "grab" cursor. */
	.bookmarklet {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.375rem 0.875rem 0.375rem 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-brand-soft-text);
		text-decoration: none;
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: 999px;
		cursor: grab;
	}

	.bookmarklet:active {
		cursor: grabbing;
	}

	.grip {
		fill: currentColor;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.steps {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	summary {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.keyboard-body {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.5rem;
	}
</style>
