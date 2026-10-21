#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Install/update the native app, or open it without downloading when current.
set -euo pipefail
umask 077
status() { printf 'Harness Connect: %s\n' "$*" >&2; }
die() { status "$*"; exit 1; }
[[ $(uname -s) == Darwin ]] || die 'This installer requires macOS.'
case "$(uname -m)" in arm64) ARCH=arm64;; x86_64) ARCH=x64;; *) die 'Unsupported Mac architecture';; esac
REPO=https://github.com/YLlllllllllll/deepseek-harness-connect
ROOT="$HOME/Applications"
APP="$ROOT/Harness Connect.app"
if [[ ! -d $APP && -d '/Applications/Harness Connect.app' ]]; then APP='/Applications/Harness Connect.app'; fi
version() { plutil -extract CFBundleShortVersionString raw -o - "$1/Contents/Info.plist" 2>/dev/null || true; }
CURRENT=$(version "$APP")
open_app() { status "Opening $APP"; open "$APP"; }
status 'Checking latest App release (metadata only)'
if ! RELEASE=$(curl --fail --location --silent --show-error --head --connect-timeout 10 --max-time 30 \
    --output /dev/null --write-out '%{url_effective}' "$REPO/releases/latest"); then
  if [[ -d $APP ]]; then status 'Update check unavailable; using installed App'; open_app; exit 0; fi
  die 'Cannot check releases. Check your download proxy and retry.'
fi
TAG=${RELEASE##*/}
[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'Unexpected latest release URL'
VERSION=${TAG#v}
if [[ $CURRENT =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] &&
   awk -v current="$CURRENT" -v latest="$VERSION" 'BEGIN {split(current,a,".");split(latest,b,".");for(i=1;i<=3;i++){if(a[i]+0>b[i]+0)exit 0;if(a[i]+0<b[i]+0)exit 1}exit 0}'; then
  status "App $CURRENT already current; skipping App download"
  open_app; exit 0
fi
if [[ -d $APP ]] && pgrep -x 'Harness Connect' >/dev/null; then
  status "App is running; keeping it active. Quit and rerun to update to $VERSION."
  open_app; exit 0
fi
# User-owned installation needs no sudo, even if the old copy is system-wide.
APP="$ROOT/Harness Connect.app"
mkdir -p "$ROOT"
LOCK="$ROOT/.harness-connect-install.lock"
mkdir "$LOCK" 2>/dev/null || die 'Another install is in progress.'
STAGE=
PREVIOUS=
cleanup() {
  if [[ -n $PREVIOUS && -d $PREVIOUS && ! -e $APP ]]; then
    if ! mv "$PREVIOUS" "$APP"; then status "Previous App retained at $PREVIOUS"; STAGE=; fi
  fi
  if [[ -n $STAGE && -d $STAGE ]]; then rm -rf -- "$STAGE"; fi
  rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
STAGE=$(mktemp -d "$ROOT/.harness-connect.XXXXXX")
FILE="Harness-Connect-$VERSION-$ARCH.zip"
BASE="$REPO/releases/download/$TAG"
status "Downloading App $VERSION ($ARCH)"
curl --fail --location --progress-bar --show-error --retry 2 --connect-timeout 15 --max-time 600 "$BASE/$FILE" -o "$STAGE/app.zip"
curl --fail --location --silent --show-error --connect-timeout 15 --max-time 30 "$BASE/SHA256SUMS" -o "$STAGE/SHA256SUMS"
EXPECTED=$(awk -v file="$FILE" '$2==file {print $1}' "$STAGE/SHA256SUMS")
[[ $EXPECTED =~ ^[a-f0-9]{64}$ ]] || die 'Installer checksum missing from release'
ACTUAL=$(shasum -a 256 "$STAGE/app.zip")
[[ ${ACTUAL%% *} == "$EXPECTED" ]] || die 'Installer checksum mismatch; existing App retained'
ditto -x -k "$STAGE/app.zip" "$STAGE/unpacked"
NEW="$STAGE/unpacked/Harness Connect.app"
[[ $(version "$NEW") == "$VERSION" ]] || die 'App version differs from release'
[[ $(plutil -extract CFBundleIdentifier raw -o - "$NEW/Contents/Info.plist") == io.github.ylllllllllll.harness-connect ]] || die 'Unexpected App identity'
codesign --verify --deep --strict "$NEW"
if [[ -d $APP ]] && pgrep -x 'Harness Connect' >/dev/null; then
  status 'App started during download; keeping it active. Quit and rerun to update.'
  open_app; exit 0
fi
if [[ -d $APP ]]; then PREVIOUS="$STAGE/previous.app"; mv "$APP" "$PREVIOUS"; fi
mv "$NEW" "$APP"
status "App $VERSION installed; existing settings and sessions preserved"
if ! open_app; then
  if [[ -n $PREVIOUS ]]; then
    mv "$APP" "$STAGE/failed.app"
    die 'Launch failed; restoring the previous App'
  fi
  die "App installed at $APP. If macOS blocked launch, allow it in Privacy & Security, then reopen."
fi
status 'At startup, compatible local dsh is reused; missing runtime is installed separately.'
