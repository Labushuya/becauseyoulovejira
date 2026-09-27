// markdown-it-ins 4 ships no types (ADR-0032 section 1): a markdown-it plugin without options that
// turns "++text++" into ins_open/ins_close tokens.
declare module 'markdown-it-ins' {
	import type { MarkdownIt } from 'markdown-it';

	const markdownItIns: (md: MarkdownIt) => void;
	export default markdownItIns;
}
