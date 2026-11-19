import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { run } from "../cli";
import { fakeDeps, fixtureSpec, TOKEN } from "./fixtures";

const RUN_ID = "0190a0a0-0000-7000-8000-000000000001";

type Answer = (body: unknown) => Response;

/** Serves the spec and answers each tool by name. */
function agentsApi(answers: Record<string, Answer>) {
	return (url: string, init: RequestInit | undefined) => {
		if (url.endsWith("/openapi/tools.json")) return Response.json(fixtureSpec);

		const name = url.split("/v1/tools/")[1] ?? "";
		const answer = answers[name];

		if (!answer) return new Response("unexpected tool", { status: 500 });

		return answer(JSON.parse(String(init?.body ?? "{}")));
	};
}

const signedIn = { env: { BETTEROFF_API_TOKEN: TOKEN } };

const toolCalls = (requests: { url: string }[]) =>
	requests.flatMap((request) => {
		const name = request.url.split("/v1/tools/")[1];

		return name ? [name] : [];
	});

describe("agents", () => {
	test("`agents` lists the agents", async () => {
		const harness = fakeDeps(
			agentsApi({
				betteroff_list_agents: () =>
					Response.json({ ok: true, agents: [{ key: "chief_of_staff", name: "Chief" }] }),
			}),
			signedIn,
		);

		expect(await run(["agents"], harness.deps)).toBe(0);
		expect(toolCalls(harness.requests)).toEqual(["betteroff_list_agents"]);
		expect(harness.stdout()).toContain("Chief");
	});

	test("`chief-list` reads Chief's weekly list", async () => {
		const harness = fakeDeps(
			agentsApi({
				betteroff_get_chief_list: () =>
					Response.json({ ok: true, list: { detail: "1. Pay the Visa $420 by Dec 1." } }),
			}),
			signedIn,
		);

		expect(await run(["chief-list"], harness.deps)).toBe(0);
		expect(toolCalls(harness.requests)).toEqual(["betteroff_get_chief_list"]);
		expect(harness.stdout()).toContain("Pay the Visa");
	});

	test("the run tool has no command of its own", async () => {
		const harness = fakeDeps(agentsApi({}), signedIn);

		expect(await run(["run-agent", "--agent", "chief"], harness.deps)).toBe(2);
		expect(toolCalls(harness.requests)).toEqual([]);
	});

	test("`agents run <name>` starts the agent and prints the run id", async () => {
		const sent: unknown[] = [];
		const harness = fakeDeps(
			agentsApi({
				betteroff_run_agent: (body) => {
					sent.push(body);

					return Response.json({ ok: true, runId: RUN_ID, message: "Chief started." });
				},
			}),
			signedIn,
		);

		expect(await run(["agents", "run", "chief"], harness.deps)).toBe(0);
		expect(sent).toEqual([{ agent: "chief" }]);
		expect(z.object({ runId: z.string() }).parse(JSON.parse(harness.stdout())).runId).toBe(RUN_ID);
		expect(harness.stderr()).toContain(`betteroff agent-run --run-id ${RUN_ID}`);
	});

	test("--wait checks the run until it finishes, then prints its findings", async () => {
		const statuses = ["running", "running", "completed"];
		const harness = fakeDeps(
			agentsApi({
				betteroff_run_agent: () => Response.json({ ok: true, runId: RUN_ID }),
				betteroff_get_agent_run: () =>
					Response.json({
						ok: true,
						run: { runId: RUN_ID, status: statuses.shift() ?? "completed" },
						findings: [{ headline: "Car insurance renews Dec 1" }],
					}),
			}),
			signedIn,
		);

		expect(await run(["agents", "run", "Negotiator", "--wait"], harness.deps)).toBe(0);
		expect(toolCalls(harness.requests)).toEqual([
			"betteroff_run_agent",
			"betteroff_get_agent_run",
			"betteroff_get_agent_run",
			"betteroff_get_agent_run",
		]);
		expect(harness.stdout()).toContain("Car insurance renews Dec 1");
	});

	test("a plan without the agent shows the Plus trial link", async () => {
		const harness = fakeDeps(
			agentsApi({
				betteroff_run_agent: () =>
					Response.json(
						{
							ok: false,
							code: "PLAN_REQUIRED",
							message: "Chief is included with Plus.",
							nextStep: "Start a free Plus trial: https://app.betteroff.finance/billing/start",
						},
						{ status: 402 },
					),
			}),
			signedIn,
		);

		expect(await run(["agents", "run", "chief"], harness.deps)).toBe(1);
		expect(harness.stderr()).toContain("Chief is included with Plus. (PLAN_REQUIRED)");
		expect(harness.stderr()).toContain("Start a free Plus trial: https://app.betteroff.finance");
	});

	test("a held agent reports the wait", async () => {
		const harness = fakeDeps(
			agentsApi({
				betteroff_run_agent: () =>
					Response.json(
						{ ok: false, code: "RATE_LIMITED", retryAfterSeconds: 360 },
						{ status: 429, headers: { "retry-after": "360" } },
					),
			}),
			signedIn,
		);

		expect(await run(["agents", "run", "scout"], harness.deps)).toBe(1);
		expect(harness.stderr()).toContain("Rate limited. Try again in 360 seconds.");
	});

	test.each([
		[["agents", "run"]],
		[["agents", "run", "chief", "scout"]],
		[["agents", "run", "--x"]],
	])("%p prints usage and calls nothing", async (argv) => {
		const harness = fakeDeps(agentsApi({}), signedIn);

		expect(await run(argv, harness.deps)).toBe(2);
		expect(harness.stderr()).toContain("Usage: betteroff agents run <name>");
		expect(toolCalls(harness.requests)).toEqual([]);
	});

	test("`agents run --help` prints usage without signing in", async () => {
		const harness = fakeDeps(agentsApi({}));

		expect(await run(["agents", "run", "--help"], harness.deps)).toBe(0);
		expect(harness.stdout()).toContain("never moves money");
		expect(harness.requests).toEqual([]);
	});
});
