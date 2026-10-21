#!/usr/bin/env bash
# Bundle only the public npm runtime; never include connection state or logs.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
INPUT=${1:?Usage: bash bundle-runtime.sh /path/to/installed/runtime}
INPUT=$(cd "$INPUT" && pwd)
VERSION=$(node -p 'require(process.argv[1]).version' "$INPUT/node_modules/@deepseek-ai/dsh/package.json")
PROFILE=$(node -p '[process.platform,process.arch,"node"+process.versions.node.split(".")[0],"abi"+process.versions.modules].join("-")')
[[ $VERSION == 0.2.1-rc.2 && $PROFILE == linux-x64-node24-abi137 ]] || { echo 'This release supports dsh 0.2.1-rc.2 on Linux x64 / Node 24 ABI 137' >&2; exit 1; }
mkdir -p "$ROOT/dist"
TEMP=$(mktemp -d)
trap 'rm -rf -- "$TEMP"' EXIT
node --input-type=module - "$INPUT" "$TEMP/BUNDLE.json" <<'JS'
import {readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync} from 'node:fs';
import {join, relative} from 'node:path';
import {createHash} from 'node:crypto';
const [root, output] = process.argv.slice(2);
const modules = realpathSync(join(root, 'node_modules'));
function audit(dir) {
  for (const name of readdirSync(dir)) {
    if (['.env', '.npmrc', '.git'].includes(name)) throw new Error('Unexpected private config in runtime');
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) {
      const target = relative(modules, realpathSync(path));
      if (target === '..' || target.startsWith('../')) throw new Error('External runtime symlink');
    } else if (lstatSync(path).isDirectory()) audit(path);
  }
}
audit(modules);
const lock = readFileSync(join(root, 'package-lock.json'));
writeFileSync(output, JSON.stringify({schema: 1, harness: '0.2.1-rc.2', platform: process.platform,
  arch: process.arch, nodeMajor: 24, nodeAbi: process.versions.modules,
  lockSha256: createHash('sha256').update(lock).digest('hex')}, null, 2) + '\n');
JS
NAME="dsh-$VERSION-$PROFILE.tar.gz"
tar -cf - -C "$INPUT" node_modules package.json package-lock.json -C "$TEMP" BUNDLE.json | gzip -6 > "$ROOT/dist/$NAME"
cd "$ROOT/dist"
if command -v sha256sum >/dev/null; then sha256sum "$NAME" > "$NAME.sha256";
else shasum -a 256 "$NAME" > "$NAME.sha256"; fi
cat "$NAME.sha256"
