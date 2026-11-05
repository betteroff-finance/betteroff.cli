/**
 * Control characters and bidirectional overrides. Bank and merchant text reaches the terminal
 * through the API, and these can move the cursor, rewrite the screen, or reorder what is shown.
 */
const UNSAFE_CHARACTERS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Stripping terminal control characters is the purpose of this pattern.
	/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u200b\u2028\u2029\u3164\ufeff\u{e0000}-\u{e007f}]/gu;

/** JSON already escapes C0 controls; these are the rest a terminal would act on. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Stripping terminal control characters is the purpose of this pattern.
const UNSAFE_IN_JSON =
	/[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u200b\u2028\u2029\u3164\ufeff\u{e0000}-\u{e007f}]/gu;

/** Text safe to print: line breaks and tabs become spaces, other unsafe characters become U+FFFD. */
export function safeText(text: string): string {
	return text.replace(UNSAFE_CHARACTERS, (character) =>
		character === "\n" || character === "\r" || character === "\t" ? " " : "�",
	);
}

/** The same JSON with unsafe characters written as `\u` escapes, so it still parses to the same value. */
export function safeJson(json: string): string {
	return json.replace(
		UNSAFE_IN_JSON,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}
