/**
 * Voice check for every command's `--help` output. Fails on an em dash or a listed buzzword;
 * prints sentences over 25 words as warnings. Mirrors the site's check-prose script in the
 * BetterOff monorepo (finance/apps/site/scripts/check-prose.ts), so keep the lists in step.
 *
 *   bun run check:help-voice
 */

import { allCommands, runCli } from "../src/test/commands";

const LONG_SENTENCE_WORDS = 25;

/** Words that pad copy without saying anything checkable. Matched as whole words, any case. */
const BUZZWORDS = [
	"seamless",
	"seamlessly",
	"leverage",
	"empower",
	"supercharge",
	"game-changer",
	"cutting-edge",
	"revolutionize",
	"unlock the power",
	"delve",
	"robust",
] as const;

export interface VoiceIssue {
	command: string;
	line: number;
	kind: "em-dash" | "buzzword" | "long-sentence";
	detail: string;
}

/**
 * Wrapped prose joined back into paragraphs. Flag rows, command columns, and `One of:` choice
 * lists are not sentences, so they end a paragraph instead of joining it.
 */
function proseParagraphs(lines: string[]): string[] {
	const paragraphs: string[] = [];
	let current: string[] = [];
	let inChoices = false;

	const flush = () => {
		if (current.length > 0) paragraphs.push(current.join(" "));
		current = [];
	};

	for (const raw of lines) {
		const text = raw.trim();
		const indent = raw.length - raw.trimStart().length;

		// A choice list wraps onto lines with the same indent; it ends at the next shallower line.
		if (inChoices && indent >= 6 && !text.startsWith("--")) continue;

		inChoices = text.startsWith("One of:");

		const listing = text.startsWith("--") || /\S {2,}\S/.test(text) || inChoices;

		if (text === "" || listing) flush();
		else current.push(text);
	}

	flush();

	return paragraphs;
}

/** Help text wraps sentences across lines, so sentences are read from the joined paragraph. */
export function checkHelpVoice(command: string, text: string): VoiceIssue[] {
	const issues: VoiceIssue[] = [];
	const lines = text.split("\n");

	lines.forEach((raw, index) => {
		const line = index + 1;

		if (raw.includes("—")) issues.push({ command, line, kind: "em-dash", detail: raw.trim() });

		for (const word of BUZZWORDS) {
			if (new RegExp(`\\b${word}\\b`, "i").test(raw))
				issues.push({ command, line, kind: "buzzword", detail: `${word}: ${raw.trim()}` });
		}
	});

	for (const paragraph of proseParagraphs(lines)) {
		for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
			const words = sentence.split(/\s+/).filter(Boolean).length;

			if (words > LONG_SENTENCE_WORDS)
				issues.push({
					command,
					line: 0,
					kind: "long-sentence",
					detail: `${words} words: ${sentence.slice(0, 80)}…`,
				});
		}
	}

	return issues;
}

if (import.meta.main) {
	const out = (text: string) => process.stdout.write(`${text}\n`);
	const err = (text: string) => process.stderr.write(`${text}\n`);

	const commands = allCommands();
	const issues: VoiceIssue[] = [];

	for (const argv of commands) {
		const name = argv.length > 0 ? argv.join(" ") : "(top level)";
		const output = await runCli([...argv, "--help"], { tty: false, noColor: true, columns: 100 });

		if (output.exitCode !== 0 || output.stdout.trim() === "") {
			err(`${name}: --help exited ${output.exitCode}: ${output.stderr.trim()}`);
			process.exit(1);
		}

		issues.push(...checkHelpVoice(name, output.stdout));
	}

	const errors = issues.filter((issue) => issue.kind !== "long-sentence");
	const warnings = issues.filter((issue) => issue.kind === "long-sentence");

	for (const issue of warnings) out(`warning: ${issue.command} long-sentence: ${issue.detail}`);

	for (const issue of errors) err(`${issue.command}:${issue.line} ${issue.kind}: ${issue.detail}`);

	if (errors.length > 0) {
		err(`error: ${errors.length} help-text issue(s). Remove em dashes and listed buzzwords.`);
		process.exit(1);
	}

	out(
		`ok: ${commands.length} help page(s) checked; ${warnings.length} sentence(s) over ${LONG_SENTENCE_WORDS} words (warning only).`,
	);
}
