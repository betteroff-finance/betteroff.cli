/**
 * Output snapshots: the main commands run against fixture data, and every command's `--help`, with
 * the terminal fixed per case (tty, NO_COLOR, width). Each case is one file under
 * `src/test/__output__/`, with ESC written as `␛` so color codes show in a diff.
 *
 *   bun run test:output                 # compare
 *   UPDATE_OUTPUT_SNAPSHOTS=1 bun run test:output   # rewrite after an intended change
 */

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "../json";
import { allCommands, type Output, runCli, type Terminal } from "./commands";

const SNAPSHOT_DIR = join(import.meta.dir, "__output__");

const UPDATE = process.env.UPDATE_OUTPUT_SNAPSHOTS === "1";

const COLOR: Terminal = { tty: true, noColor: false, columns: 100 };

const NO_COLOR: Terminal = { tty: true, noColor: true, columns: 100 };

const NARROW: Terminal = { tty: true, noColor: false, columns: 60 };

const PIPED: Terminal = { tty: false, noColor: false, columns: 100 };

const envelope = (data: JsonValue, extra: Record<string, JsonValue> = {}) =>
	Response.json({
		ok: true,
		data,
		currency: "USD",
		asOf: "2026-11-02T14:05:00Z",
		warnings: [],
		...extra,
	});

/** Tool responses keyed by tool name. Shapes follow the API's results, cut down. */
const RESPONSES: Record<string, () => Response> = {
	betteroff_list_accounts: () =>
		envelope([
			{
				id: "acc_1",
				displayName: "Everyday Checking",
				institution: "First Federal",
				type: "checking",
				balance: "4210.55",
				currency: "USD",
				lastSyncedAt: "2026-11-02T13:58:12Z",
				isHidden: false,
			},
			{
				id: "acc_2",
				displayName: "Rewards Card ••4021",
				institution: "Northline",
				type: "credit",
				balance: "-1289.30",
				currency: "USD",
				lastSyncedAt: "2026-11-02T13:58:12Z",
				isHidden: false,
			},
			{
				id: "acc_3",
				displayName: "Brokerage (joint, long-term holdings account)",
				institution: "Harbor Securities",
				type: "investment",
				balance: "182004.10",
				currency: "USD",
				lastSyncedAt: null,
				isHidden: true,
			},
		]),
	betteroff_search_transactions: () =>
		envelope(
			{
				transactions: [
					{
						id: "txn_1",
						date: "2026-11-01",
						merchant: "Café Lumière",
						amount: "-18.40",
						category: "FOOD_AND_DRINK",
						accountId: "acc_2",
						pending: true,
					},
					{
						id: "txn_2",
						date: "2026-10-31",
						merchant: "Acme Payroll\u001b[2J",
						amount: "3125.00",
						category: "INCOME",
						accountId: "acc_1",
						pending: false,
					},
					{
						id: "txn_3",
						date: "2026-10-30",
						merchant: null,
						amount: "-1.00",
						category: null,
						accountId: "acc_1",
						pending: false,
					},
				],
				summary: { count: 3, total: "3105.60", inflow: "3125.00", outflow: "-19.40" },
			},
			{
				page: {
					returnedCount: 3,
					totalCount: 41,
					truncated: true,
					nextCursor: { offset: 3 },
				},
			},
		),
	betteroff_get_portfolio: () =>
		envelope(
			{
				totalValue: "182004.10",
				dayChange: "-412.88",
				dayChangePercent: -0.23,
				holdings: [
					{
						symbol: "VTI",
						name: "Vanguard Total Stock Market ETF",
						quantity: "410.5",
						price: "301.22",
						value: "123650.81",
						weightPercent: 67.9,
					},
					{
						symbol: "BND",
						name: "Vanguard Total Bond Market ETF",
						quantity: "520",
						price: "72.10",
						value: "37492.00",
						weightPercent: 20.6,
					},
					{
						symbol: "USDC",
						name: "USD Coin",
						quantity: "20861.29",
						price: "1.00",
						value: "20861.29",
						weightPercent: 11.5,
					},
				],
			},
			{ quality: { state: "partial", reasons: ["Harbor Securities last synced 3 days ago."] } },
		),
	betteroff_get_overview: () =>
		envelope({
			netWorth: "185925.35",
			assets: "187214.65",
			liabilities: "-1289.30",
			monthToDate: { income: "3125.00", spending: "-1840.22", savingsRatePercent: 41 },
			topCategories: ["Groceries", "Dining", "Utilities"],
			needsAttention: [
				"Rewards Card ••4021 payment due Nov 14",
				"2 transactions need a category",
				"Estimated Q4 tax payment due Jan 15",
			],
		}),
	betteroff_get_budgets: () =>
		envelope([
			{ category: "Groceries", budgeted: "600.00", spent: "412.18", remaining: "187.82" },
			{ category: "Dining", budgeted: "250.00", spent: "301.40", remaining: "-51.40" },
			{ category: "Utilities", budgeted: "220.00", spent: "0", remaining: "220.00" },
		]),
	betteroff_list_recurring: () =>
		envelope([
			{
				merchant: "Streamflix",
				amount: "-15.99",
				frequency: "monthly",
				nextDate: "2026-11-12",
				kind: "subscription",
			},
			{
				merchant: "City Water",
				amount: "-64.20",
				frequency: "monthly",
				nextDate: "2026-11-20",
				kind: "bill",
			},
		]),
	betteroff_list_debts: () => envelope([]),
	betteroff_get_chief_list: () =>
		envelope(
			{
				week: "2026-W45",
				items: [
					{
						rank: 1,
						title: "Pay Rewards Card before Nov 14",
						agent: "Chief",
						dueDate: "2026-11-14",
					},
					{
						rank: 2,
						title: "Categorize 2 transactions",
						agent: "Bookkeeper",
						dueDate: null,
					},
				],
			},
			{ warnings: ["Scout has not run this week."] },
		),
	betteroff_list_agents: () =>
		envelope([
			{ name: "Chief", enabled: true, lastRunAt: "2026-11-02T06:00:00Z", openFindings: 2 },
			{ name: "Scout", enabled: false, lastRunAt: null, openFindings: 0 },
		]),
	betteroff_run_agent: () => Response.json({ runId: "run_123" }),
};

const notFound = () => Response.json({ ok: false, error: "No such tool." }, { status: 404 });

const respond = (tool: string) => (RESPONSES[tool] ?? notFound)();

type Case = { name: string; argv: string[]; terminal: Terminal; env?: Record<string, string> };

function terminalLabel({ tty, noColor, columns }: Terminal): string {
	return [tty ? "tty" : "piped", noColor ? "NO_COLOR=1" : "color", `columns=${columns}`].join(", ");
}

const DATA_COMMANDS = [
	"accounts",
	"transactions",
	"portfolio",
	"overview",
	"budgets",
	"recurring",
	"debts",
	"chief-list",
	"agents",
];

const CASES: Case[] = [
	...DATA_COMMANDS.flatMap((command) => [
		{ name: `${command}.color`, argv: [command], terminal: COLOR },
		{ name: `${command}.no-color`, argv: [command], terminal: NO_COLOR },
	]),
	{ name: "accounts.narrow", argv: ["accounts"], terminal: NARROW },
	{ name: "transactions.narrow", argv: ["transactions"], terminal: NARROW },
	{ name: "accounts.piped", argv: ["accounts"], terminal: PIPED },
	{ name: "accounts.json", argv: ["accounts", "--json"], terminal: COLOR },
	{ name: "agents-run", argv: ["agents", "run", "chief"], terminal: COLOR },
	{ name: "version", argv: ["--version"], terminal: COLOR },
	{ name: "error.unknown-command", argv: ["acounts"], terminal: COLOR },
	{ name: "error.bad-choice", argv: ["portfolio", "--group-by", "color"], terminal: COLOR },
	{ name: "error.signed-out", argv: ["accounts"], terminal: COLOR, env: {} },
	...allCommands().map((argv) => ({
		name: `help.${argv.length > 0 ? argv.join("-") : "top-level"}`,
		argv: [...argv, "--help"],
		terminal: COLOR,
	})),
	{ name: "help.top-level.no-color", argv: ["--help"], terminal: NO_COLOR },
	{ name: "help.transactions.narrow", argv: ["transactions", "--help"], terminal: NARROW },
];

function format(testCase: Case, output: Output): string {
	const env = testCase.env ? " (signed out)" : "";
	const visible = (text: string) => text.replaceAll("\u001b", "␛");

	return [
		`$ betteroff ${testCase.argv.join(" ")}`.trimEnd(),
		`# ${terminalLabel(testCase.terminal)}${env}`,
		`# exit ${output.exitCode}`,
		"--- stdout",
		visible(output.stdout),
		"--- stderr",
		visible(output.stderr),
	].join("\n");
}

const fileOf = (name: string) => join(SNAPSHOT_DIR, `${name}.txt`);

if (UPDATE) mkdirSync(SNAPSHOT_DIR, { recursive: true });

test.each(CASES.map((testCase) => [testCase.name, testCase] as const))(
	"%s",
	async (_, testCase) => {
		const output = await runCli(testCase.argv, testCase.terminal, respond, testCase.env);
		const actual = format(testCase, output);
		const file = fileOf(testCase.name);

		if (UPDATE) {
			writeFileSync(file, actual);

			return;
		}

		if (!existsSync(file))
			throw new Error(
				`No snapshot for ${testCase.name}. Run: UPDATE_OUTPUT_SNAPSHOTS=1 bun run test:output`,
			);

		expect(actual).toBe(readFileSync(file, "utf8"));
	},
);

test("every snapshot file belongs to a case", () => {
	const expected = new Set(CASES.map((testCase) => `${testCase.name}.txt`));
	const stale = readdirSync(SNAPSHOT_DIR).filter((file) => !expected.has(file));

	if (UPDATE) {
		for (const file of stale) rmSync(join(SNAPSHOT_DIR, file));

		return;
	}

	expect(stale).toEqual([]);
});

test("case names are unique", () => {
	const names = CASES.map((testCase) => testCase.name);

	expect(new Set(names).size).toBe(names.length);
});
