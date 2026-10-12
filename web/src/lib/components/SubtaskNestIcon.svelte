<script lang="ts">
	// The corner of a sub-task indented directly below its parent (ADR-0033 section 5): drawn before
	// the title in the table "Aufgaben" and, since TP-3, in plan, pool and suggestions of the day plan.
	// Only decoration; the text for screen readers comes from `SubtaskPath` (`path` false). The place
	// around it is the caller's.
</script>

<svg
	class="nest-icon"
	viewBox="0 0 16 16"
	width="12"
	height="12"
	aria-hidden="true"
	focusable="false"
>
	<path d="M4 2.5v6.5h8.5M10 6.5l2.5 2.5L10 11.5" />
</svg>

<style>
	.nest-icon {
		flex: none;
		vertical-align: middle;
		color: var(--color-text-muted);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
