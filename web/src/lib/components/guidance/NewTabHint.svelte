<!--
	The hidden end of the name of a link that opens a new tab (ADR-0026 section 6 and addendum of
	2026-10-01): " (öffnet in neuem Tab)" for ExternalLink, the outside entries of ActionsMenu and
	the link to the help in the quick capture. The space is a text node of the link itself, written
	as an expression: Svelte 5 removes white space at the start of an element's content, so a space
	inside the hidden span was lost, and the computation of a name drops the white space at the edges
	of a child element anyway. Visible it is at most a space at the end of the link (in a flex or
	grid item it hangs at the end of the line); a gap from CSS would not reach the name at all.
-->
<!-- eslint-disable-next-line svelte/no-useless-mustaches -- only an expression keeps this space (see above) -->
{' '}<span class="visually-hidden">(öffnet in neuem Tab)</span>
