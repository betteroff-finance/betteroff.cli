#!/usr/bin/env bash
# Fails if a compiled binary loads bunfig.toml or .env from the directory it runs in.
set -euo pipefail

binary="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
"$binary" --version >/dev/null
directory="$(mktemp -d)"
trap 'rm -rf "$directory"' EXIT
cd "$directory"

printf 'preload = ["./preload.js"]\n' >bunfig.toml
printf 'require("node:fs").writeFileSync("preloaded", "");\n' >preload.js
printf 'BETTEROFF_TOKEN=from-dotenv\n' >.env

output="$(HOME="$directory" "$binary" status 2>&1 || true)"

if [[ -e preloaded ]]; then
	echo "The binary ran a preload from bunfig.toml in the working directory." >&2
	exit 1
fi

if [[ "$output" == *from-dot* ]]; then
	echo "The binary read .env from the working directory." >&2
	exit 1
fi
