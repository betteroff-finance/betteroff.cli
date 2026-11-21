import { type CliDeps, run, VERSION } from "../cli";
import { toolsFromSpec, toolsSpecSchema } from "../spec";
import { fakeDeps, TOKEN } from "./fixtures";
import toolsSpec from "./tools-spec.json";

/**
 * A copy of the live /openapi/tools.json (responses left out), so help pages and command names
 * match what users see without a network call. Refresh it when the API adds or renames tools.
 */
export const liveSpec = toolsSpecSchema.parse(toolsSpec);

/** Commands the CLI defines itself rather than reading from the spec. */
const BUILT_IN = [["agents", "run"], ["login"], ["logout"], ["status"]];

/** Every command a user can ask `--help` for, as argv. The empty list is `betteroff --help`. */
export function allCommands(): string[][] {
	return [[], ...toolsFromSpec(liveSpec).map((tool) => [tool.command]), ...BUILT_IN];
}

export type Terminal = {
	/** stdout is a terminal, so results render as tables and text may be styled. */
	tty: boolean;
	noColor: boolean;
	columns: number;
};

export type Output = { exitCode: number; stdout: string; stderr: string };

/**
 * Runs the CLI against `respond` with a fixed terminal. Nothing reads the real environment,
 * keychain, or network, and the version is replaced so a release does not change the output.
 */
export async function runCli(
	argv: string[],
	terminal: Terminal,
	respond: (tool: string) => Response = () => Response.json({ ok: true, data: null }),
	env: Record<string, string> = { BETTEROFF_API_TOKEN: TOKEN },
): Promise<Output> {
	const overrides: Partial<CliDeps> = {
		env: terminal.noColor ? { ...env, NO_COLOR: "1" } : env,
		stdoutIsTTY: terminal.tty,
		columns: terminal.columns,
	};

	const harness = fakeDeps((url) => {
		if (url.endsWith("/openapi/tools.json")) return Response.json(toolsSpec);

		return respond(url.slice(url.lastIndexOf("/") + 1));
	}, overrides);

	const exitCode = await run(argv, harness.deps);
	const version = (text: string) => text.replaceAll(VERSION, "<version>");

	return { exitCode, stdout: version(harness.stdout()), stderr: version(harness.stderr()) };
}
