#!/usr/bin/env bash
# Build the native, offline desktop payload on the target OS/architecture.
set -euo pipefail
umask 022
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TARGET="$ROOT/macapp/runtime"
[[ ! -e $TARGET ]] || { echo 'macapp/runtime already exists; use a fresh build checkout' >&2; exit 1; }
STAGE=$(mktemp -d "$ROOT/macapp/.runtime.XXXXXX")
trap '[[ ! -d $STAGE ]] || rm -rf -- "$STAGE"' EXIT
NODE_PREFIX=$(node -p 'require("node:path").dirname(require("node:path").dirname(process.execPath))')
node -e 'if(process.versions.node!=="24.15.0")throw new Error("Build requires Node 24.15.0")'
mkdir -p "$STAGE/node/bin" "$STAGE/node/lib/node_modules"
cp "$NODE_PREFIX/bin/node" "$STAGE/node/bin/node"
cp -a "$NODE_PREFIX/lib/node_modules/npm" "$STAGE/node/lib/node_modules/npm"
cp "$NODE_PREFIX/LICENSE" "$STAGE/node/LICENSE"
ln -s ../lib/node_modules/npm/bin/npm-cli.js "$STAGE/node/bin/npm"
ln -s ../lib/node_modules/npm/bin/npx-cli.js "$STAGE/node/bin/npx"
export PATH="$STAGE/node/bin:$PATH"
echo 'Preparing pinned Harness and SSH plugins for the desktop package' >&2
npm install --prefix "$STAGE/pnpm" --ignore-scripts --no-audit --no-fund --progress=false pnpm@11.0.8
export PATH="$STAGE/pnpm/node_modules/.bin:$PATH"
npm install --prefix "$STAGE/harness" --save-exact --no-audit --no-fund --progress=false @deepseek-ai/dsh@0.2.1-rc.2
DSH_HOME="$STAGE/template" "$STAGE/harness/node_modules/.bin/dsh" plugin --profile web add --save-exact \
  dsh-better-sidebar@0.28.0 @zhangfengshun/dsh-remote-ssh@2.4.36 \
  --registry=https://registry.npmjs.org --reporter=append-only
mkdir "$STAGE/web-profile"
for FILE in package.json pnpm-workspace.yaml pnpm-lock.yaml node_modules; do
  cp -a "$STAGE/template/profiles/web/$FILE" "$STAGE/web-profile/$FILE"
done
rm -rf -- "$STAGE/template"
node - "$STAGE" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2];
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
fs.writeFileSync(path.join(root,'BUNDLE.json'),JSON.stringify({schema:1,platform:process.platform,arch:process.arch,
  node:process.versions.node,nodeAbi:process.versions.modules,harness:'0.2.1-rc.2',
  harnessLock:sha('harness/package-lock.json'),profileLock:sha('web-profile/pnpm-lock.yaml')},null,2)+'\n');
JS
mv "$STAGE" "$TARGET"
echo "Desktop runtime ready: $TARGET" >&2
