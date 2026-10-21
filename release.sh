#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VERSION=${1:-v1.0.0}
[[ $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected vMAJOR.MINOR.PATCH' >&2; exit 2; }
mkdir -p "$ROOT/dist"
NAME="deepseek-harness-connect-$VERSION.tar.gz"
tar -czf "$ROOT/dist/$NAME" -C "$ROOT" connect.sh README.md LICENSE release.sh test/connect.test.mjs
cd "$ROOT/dist"
if command -v sha256sum >/dev/null; then sha256sum "$NAME" > SHA256SUMS;
else shasum -a 256 "$NAME" > SHA256SUMS; fi
printf '%s\n' "$ROOT/dist/$NAME" "$ROOT/dist/SHA256SUMS"
