// Bun install scanner (bunfig.toml [install.security]) on Socket's free malware feed, the same
// firewall API @socketsecurity/bun-security-scanner calls without a token. It is a file with no
// imports because Bun loads a file scanner before it installs anything, so a fresh install (CI,
// Vercel) could not load one that imports a package.
//
// Findings Socket marks "error" (malware) block every install. Anything else, and Socket's API
// being down, block only installs a person runs, where Bun asks whether to continue; on CI and
// Vercel they print and the install goes on, so they cannot stop a production build or a hotfix.
// bun audit in CI still gates high-severity CVEs. oss/betteroff.cli keeps a byte-for-byte copy
// (ops/checks/check-config.ts).

const API = "https://firewall-api.socket.dev/purl/";
const CONCURRENCY = 20;
const RETRIES = 4;
const unattended = Boolean(process.env.CI || process.env.VERCEL);

interface Alert {
	type?: string;
	action?: string;
	props?: { description?: unknown; note?: unknown; notes?: unknown; alternatePackage?: unknown };
	fix?: { description?: unknown };
}

interface Artifact {
	inputPurl: string;
	alerts: Alert[];
}

function parseArtifacts(body: string, purl: string): Artifact[] {
	return body
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const value: unknown = JSON.parse(line);

			if (
				typeof value !== "object" ||
				value === null ||
				!("inputPurl" in value) ||
				typeof value.inputPurl !== "string"
			) {
				throw new Error(`Socket returned an unexpected response for ${purl}`);
			}

			const alerts = "alerts" in value && Array.isArray(value.alerts) ? value.alerts : [];

			return { inputPurl: value.inputPurl, alerts: alerts as Alert[] };
		});
}

async function lookup(purl: string): Promise<Artifact[]> {
	for (let attempt = 0; ; attempt += 1) {
		let retryable: Error;

		try {
			const response = await fetch(API + encodeURIComponent(purl), {
				headers: { "User-Agent": "bun-security-scanner" },
			});
			const body = await response.text();

			if (response.ok) return parseArtifacts(body, purl);

			const error = new Error(`Socket returned ${response.status} for ${purl}`);

			if (response.status !== 408 && response.status !== 429 && response.status < 500) throw error;

			retryable = error;
		} catch (error) {
			if (!(error instanceof TypeError)) throw error;

			retryable = error;
		}

		if (attempt >= RETRIES) throw retryable;

		await Bun.sleep(1000 * 2 ** attempt);
	}
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function toAdvisories({ inputPurl, alerts }: Artifact): Bun.Security.Advisory[] {
	const [, name, version] = inputPurl.match(/^pkg:npm\/(.+)@([^@]+)$/) ?? [];
	const url =
		name === undefined ? null : `https://socket.dev/npm/package/${name}/overview/${version}`;

	return alerts.map((alert) => {
		const typo = text(alert.props?.alternatePackage);
		const notes = text(alert.props?.notes);
		const note = text(alert.props?.note);
		const fix = text(alert.fix?.description);
		const description = [
			alert.type,
			alert.type === "didYouMean" && typo !== undefined
				? `This package could be a typo-squatting attempt of ${typo}.`
				: undefined,
			text(alert.props?.description),
			notes,
			note === notes ? undefined : note,
			fix === undefined ? undefined : `Fix: ${fix}`,
		]
			.filter((part) => part !== undefined)
			.join("\n");

		return {
			level: alert.action === "error" ? "fatal" : "warn",
			package: inputPurl,
			url,
			description,
		};
	});
}

async function scanAll(packages: Bun.Security.Package[]): Promise<Bun.Security.Advisory[]> {
	// Registry packages only: workspace, file and git sources have no Socket record.
	const purls = packages
		.filter(({ version }) => /^\d+\.\d+\.\d+/.test(version))
		.map(({ name, version }) => `pkg:npm/${name}@${version}`);
	const advisories: Bun.Security.Advisory[] = [];
	let next = 0;

	async function worker(): Promise<void> {
		while (next < purls.length) {
			const purl = purls[next];

			next += 1;

			if (purl === undefined) continue;

			for (const artifact of await lookup(purl)) advisories.push(...toAdvisories(artifact));
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	return advisories;
}

export const scanner: Bun.Security.Scanner = {
	version: "1",
	async scan({ packages }) {
		let advisories: Bun.Security.Advisory[];

		try {
			advisories = await scanAll(packages);
		} catch (error) {
			if (!unattended) throw error;

			process.stderr.write(
				`Socket scan failed; installing unscanned on CI or Vercel: ${String(error)}\n`,
			);

			return [];
		}

		if (!unattended) return advisories;

		for (const advisory of advisories.filter(({ level }) => level === "warn")) {
			process.stderr.write(
				`Socket warning, not blocking on CI or Vercel: ${advisory.package}: ${advisory.description}\n`,
			);
		}

		return advisories.filter(({ level }) => level === "fatal");
	},
};
