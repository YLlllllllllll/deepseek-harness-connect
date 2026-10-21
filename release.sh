#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VERSION=${1:-v1.2.1}
[[ $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected vMAJOR.MINOR.PATCH' >&2; exit 2; }
mkdir -p "$ROOT/dist"
NAME="deepseek-harness-connect-$VERSION.tar.gz"
tar -czf "$ROOT/dist/$NAME" -C "$ROOT" connect.sh install-macos.sh README.md LICENSE release.sh bundle-runtime.sh test macapp/package.json macapp/package-lock.json macapp/main.cjs macapp/preload.cjs macapp/desktop.cjs macapp/setup.html macapp/setup.cjs
cd "$ROOT/dist"
if command -v sha256sum >/dev/null; then sha256sum "$NAME" > SHA256SUMS;
else shasum -a 256 "$NAME" > SHA256SUMS; fi
printf '%s\n' "$ROOT/dist/$NAME" "$ROOT/dist/SHA256SUMS"
