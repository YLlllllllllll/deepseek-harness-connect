#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Standalone DeepSeek Harness installer and OpenAI-compatible endpoint launcher.
set -euo pipefail
umask 077

usage() {
  cat <<'HELP'
Usage: bash connect.sh ENDPOINT [--model ID] [--check | --install-only | --run TASK] [web options]

ENDPOINT       OpenAI-compatible API root, with or without /v1; bracket IPv6 literals.
--model ID     Required when the endpoint serves more than one model.
--check        Test chat and streamed tool-call round trip, then exit; no agent runs.
--install-only Install and configure, then exit without inference or a listener.
--run TASK     Run one Harness headless task in the current working directory.
--help         Show this help.

Default: start the Web UI on 127.0.0.1:3080. Extra arguments go to dsh web,
for example --no-open --port 3081. No sudo or Python is required.

Environment: VLLM_API_KEY, DSH_DATA_DIR, DSH_VERSION, DSH_NODE_VERSION,
DSH_NPM_REGISTRY, DSH_NODE_MIRROR, DSH_CONTEXT_WINDOW, DSH_MAX_TOKENS,
DSH_INSTALL_METHOD (auto|npm|prebuilt), DSH_RUNTIME_BASE_URL.
Download proxies use standard HTTPS_PROXY/https_proxy variables. Model API
traffic is direct. No proxy, endpoint, or secret is built into this script.
HELP
}
die() { printf 'connect: %s\n' "$*" >&2; exit 1; }
status() { printf 'connect: %s\n' "$*" >&2; }
if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
[[ $# -gt 0 && -n $1 ]] || { usage >&2; exit 2; }
ENDPOINT=$1; shift
MODE=web
MODEL=${VLLM_MODEL:-}
TASK=
WEB_ARGS=()
while (($#)); do
  case "$1" in
    --model) [[ $# -ge 2 && -n $2 ]] || die '--model needs an ID'; MODEL=$2; shift 2 ;;
    --check|--install-only|--run)
      [[ $MODE == web ]] || die 'Choose only one of --check, --install-only, --run'
      case "$1" in
        --check) MODE=check; shift ;;
        --install-only) MODE=install-only; shift ;;
        --run) [[ $# -ge 2 && -n $2 ]] || die '--run needs a task'; MODE=run; TASK=$2; shift 2 ;;
      esac ;;
    --help|-h) usage; exit 0 ;;
    *) WEB_ARGS+=("$1"); shift ;;
  esac
done
[[ $MODE == web || ${#WEB_ARGS[@]} -eq 0 ]] || die 'Web options require Web mode'
case "$ENDPOINT" in http://*|https://*) ;; *) die 'ENDPOINT must start with http:// or https://' ;; esac
case "$(uname -s)" in Linux) PLATFORM=linux ;; Darwin) PLATFORM=darwin ;; *) die 'Supported OS: Linux or macOS' ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die 'Supported architectures: x64, arm64' ;; esac
DATA=${DSH_DATA_DIR:-"${XDG_DATA_HOME:-$HOME/.local/share}/deepseek-harness-connect"}
mkdir -p "$DATA"
DATA=$(cd "$DATA" && pwd)
VERSION=${DSH_VERSION:-0.2.1-rc.2}
NODE_VERSION=${DSH_NODE_VERSION:-24.15.0}
METHOD=${DSH_INSTALL_METHOD:-auto}
case "$METHOD" in auto|npm|prebuilt) ;; *) die 'DSH_INSTALL_METHOD must be auto, npm, or prebuilt' ;; esac
[[ $VERSION =~ ^[0-9][0-9A-Za-z.+-]*$ && $NODE_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'Invalid version'
STAGE=
LOCK=
INSTALL_PID=
cleanup() {
  if [[ -n $INSTALL_PID ]]; then
    kill -TERM "$INSTALL_PID" 2>/dev/null || true
    wait "$INSTALL_PID" 2>/dev/null || true
  fi
  if [[ -n $STAGE && -d $STAGE ]]; then rm -rf -- "$STAGE"; fi
  if [[ -n $LOCK && -d $LOCK ]]; then rmdir "$LOCK" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
download() {
  command -v curl >/dev/null || die 'Install curl first'
  status "Downloading ${1##*/}"
  curl --fail --location --progress-bar --show-error --retry 2 --connect-timeout 15 --max-time 300 "$1" -o "$2"
}
valid_node() {
  command -v node >/dev/null && command -v npm >/dev/null &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=24||(a===22&&b>=19)?0:1)' 2>/dev/null
}
status "[1/4] Checking Node.js ($PLATFORM/$ARCH)"
if ! valid_node; then
  NODE_HOME="$DATA/tools/node-v$NODE_VERSION-$PLATFORM-$ARCH"
  if [[ ! -x $NODE_HOME/bin/node ]]; then
    mkdir -p "$DATA/tools"
    LOCK="$NODE_HOME.lock"
    mkdir "$LOCK" 2>/dev/null || { LOCK=; die 'Another Node installation is in progress'; }
    STAGE=$(mktemp -d "$DATA/tools/.node.XXXXXX")
    FILE="node-v$NODE_VERSION-$PLATFORM-$ARCH.tar.gz"
    MIRROR=${DSH_NODE_MIRROR:-https://nodejs.org/dist}
    download "${MIRROR%/}/v$NODE_VERSION/$FILE" "$STAGE/$FILE"
    download "${MIRROR%/}/v$NODE_VERSION/SHASUMS256.txt" "$STAGE/SHASUMS256.txt"
    EXPECTED=$(awk -v file="$FILE" '$2 == file {print $1}' "$STAGE/SHASUMS256.txt")
    [[ $EXPECTED =~ ^[a-f0-9]{64}$ ]] || die 'Node archive absent from checksum manifest'
    if command -v sha256sum >/dev/null; then ACTUAL=$(sha256sum "$STAGE/$FILE");
    elif command -v shasum >/dev/null; then ACTUAL=$(shasum -a 256 "$STAGE/$FILE");
    else die 'sha256sum or shasum is required'; fi
    [[ ${ACTUAL%% *} == "$EXPECTED" ]] || die 'Node archive checksum mismatch'
    status '[1/4] Checksum verified; extracting Node.js'
    mkdir "$STAGE/node"
    tar -xzf "$STAGE/$FILE" --strip-components=1 -C "$STAGE/node"
    "$STAGE/node/bin/node" --version >/dev/null || die 'Node binary is incompatible with this host'
    [[ ! -e $NODE_HOME ]] || die "Incomplete Node installation exists: $NODE_HOME"
    mv "$STAGE/node" "$NODE_HOME"
    cleanup; STAGE=; LOCK=
  fi
  export PATH="$NODE_HOME/bin:$PATH"
fi
valid_node || die 'Node ^22.19 or >=24 and npm are required'
status "[1/4] Node.js $(node --version) ready"
PROFILE=$(node -p '[process.platform,process.arch,"node"+process.versions.node.split(".")[0],"abi"+process.versions.modules,process.report.getReport().header.glibcVersionRuntime?"glibc":"other"].join("-")')
FAST_SUPPORTED=0
if [[ $VERSION == 0.2.1-rc.2 && $PROFILE == linux-x64-node24-abi137-glibc ]]; then FAST_SUPPORTED=1; fi
[[ $METHOD != prebuilt || $FAST_SUPPORTED -eq 1 ]] || die 'Prebuilt runtime currently supports dsh 0.2.1-rc.2, Linux x64 glibc, Node 24 ABI 137'

RUNTIME="$DATA/runtime/dsh-$VERSION"
CLI="$RUNTIME/node_modules/.bin/dsh"
if [[ ! -x $CLI ]]; then
  mkdir -p "$DATA/runtime"
  LOCK="$RUNTIME.lock"
  mkdir "$LOCK" 2>/dev/null || { LOCK=; die 'Another Harness installation is in progress'; }
  STAGE=$(mktemp -d "$DATA/runtime/.dsh.XXXXXX")
  BUNDLED=0
  if [[ $METHOD != npm && $FAST_SUPPORTED -eq 1 ]]; then
    status '[2/4] Downloading prebuilt Harness runtime; skipping npm dependency resolution and installation'
    BASE=${DSH_RUNTIME_BASE_URL:-https://github.com/YLlllllllllll/deepseek-harness-connect/releases/download/v1.1.0}
    FILE=dsh-0.2.1-rc.2-linux-x64-node24-abi137.tar.gz
    EXPECTED=728363d06b1918daa95212035e7f8fcfd721ff7607a6eb3da70d7383a327a297
    if download "${BASE%/}/$FILE" "$STAGE/runtime.tar.gz"; then
      if command -v sha256sum >/dev/null; then ACTUAL=$(sha256sum "$STAGE/runtime.tar.gz");
      elif command -v shasum >/dev/null; then ACTUAL=$(shasum -a 256 "$STAGE/runtime.tar.gz");
      else die 'sha256sum or shasum is required'; fi
      [[ ${ACTUAL%% *} == "$EXPECTED" ]] || die 'Prebuilt runtime checksum mismatch'
      status '[2/4] Runtime checksum verified; extracting'
      tar -xzf "$STAGE/runtime.tar.gz" -C "$STAGE"
      rm "$STAGE/runtime.tar.gz"
      node --input-type=module - "$STAGE" <<'JS'
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root = process.argv[2];
const info = JSON.parse(readFileSync(join(root, 'BUNDLE.json')));
const sha = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex');
if (info.schema !== 1 || info.harness !== '0.2.1-rc.2' || info.platform !== process.platform ||
    info.arch !== process.arch || info.nodeMajor !== Number(process.versions.node.split('.')[0]) ||
    info.nodeAbi !== process.versions.modules || info.lockSha256 !== sha)
  throw new Error('Prebuilt runtime manifest/profile mismatch');
JS
      BUNDLED=1
    elif [[ $METHOD == prebuilt ]]; then die 'Prebuilt runtime download failed';
    else
      status '[2/4] Prebuilt download unavailable; falling back to npm'
      rm -f "$STAGE/runtime.tar.gz"
    fi
  fi
  if [[ $BUNDLED -eq 0 ]]; then
    status "[2/4] Installing Harness $VERSION; npm resolves dependencies before downloading"
    status 'npm has no overall download percentage; elapsed time and completed HTTP/cache operations follow every 5s'
    STARTED=$SECONDS
    : > "$STAGE/npm-install.log"
    npm install --prefix "$STAGE" --save-exact --no-audit --no-fund --progress=false --loglevel=http \
      --registry="${DSH_NPM_REGISTRY:-https://registry.npmjs.org}" \
      --fetch-timeout=60000 --fetch-retries=1 "@deepseek-ai/dsh@$VERSION" > "$STAGE/npm-install.log" 2>&1 &
    INSTALL_PID=$!
    while kill -0 "$INSTALL_PID" 2>/dev/null; do
      COMPLETED=$(awk '/^npm http / {n++} END {print n+0}' "$STAGE/npm-install.log")
      status "[2/4] npm: $((SECONDS-STARTED))s elapsed; $COMPLETED HTTP/cache operations completed"
      sleep 5
    done
    if wait "$INSTALL_PID"; then INSTALL_PID=;
    else
      INSTALL_CODE=$?
      INSTALL_PID=
      cat "$STAGE/npm-install.log" >&2
      die "npm install failed (exit $INSTALL_CODE)"
    fi
    status "[2/4] npm completed in $((SECONDS-STARTED))s"
    tail -n 5 "$STAGE/npm-install.log" >&2
  fi
  "$STAGE/node_modules/.bin/dsh" --version >&2
  [[ ! -e $RUNTIME ]] || die "Incomplete Harness installation exists: $RUNTIME"
  mv "$STAGE" "$RUNTIME"
  STAGE=
  cleanup; LOCK=
  status '[2/4] Harness ready'
  if [[ -f $RUNTIME/npm-install.log ]]; then status "Installation log: $RUNTIME/npm-install.log"; fi
else
  status "[2/4] Reusing installed Harness $VERSION"
fi

# Clear download proxies only in model/client subprocesses, never in the shell.
direct() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
      -u http_proxy -u https_proxy -u all_proxy NODE_USE_ENV_PROXY=0 "$@"
}
export VLLM_API_KEY=${VLLM_API_KEY:-internal-no-auth}
export DSH_TELEMETRY_DISABLED=1
status '[3/4] Connecting to endpoint and discovering models'
CONNECTION=$(direct node --input-type=module - "$ENDPOINT" "$MODEL" "$DATA" "$MODE" <<'JS'
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
const [endpoint, requestedModel, data, mode] = process.argv.slice(2);
try {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Endpoint must be HTTP(S) without credentials, query, or fragment');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/v1')) path += '/v1';
  url.pathname = path;
  const base = url.href.replace(/\/$/, '');
  const timeout = Number(process.env.DSH_API_TIMEOUT || 180) * 1000;
  const api = async (path, body) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${process.env.VLLM_API_KEY}`, 'Content-Type': 'application/json' },
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(timeout), redirect: 'error' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const {data: models} = await (await api('/models')).json();
  if (!Array.isArray(models) || !models.length) throw new Error('/models returned no models');
  if (!requestedModel && models.length !== 1)
    throw new Error('Multiple models; choose --model from: ' + models.map(m => m.id).join(', '));
  const model = requestedModel || models[0].id;
  const metadata = models.find(m => m.id === model);
  if (!metadata) throw new Error('Requested model absent from /models');
  const context = Number(process.env.DSH_CONTEXT_WINDOW || metadata.max_model_len || 32768);
  const maxTokens = Number(process.env.DSH_MAX_TOKENS || Math.min(4096, Math.floor(context / 4)));
  if (!Number.isSafeInteger(context) || !Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens >= context)
    throw new Error('Require integer 0 < DSH_MAX_TOKENS < DSH_CONTEXT_WINDOW');
  const id = createHash('sha256').update(JSON.stringify([base, model])).digest('hex').slice(0, 20);
  const state = join(data, 'connections', id);
  mkdirSync(state, {recursive: true, mode: 0o700});
  const patch = [
    {id: 'llm-deepseek', disabled: true},
    {id: 'llm-pi-ai', config: {providers: {'self-hosted': {
      displayName: 'Self-hosted', apiKeyEnv: 'VLLM_API_KEY', api: 'openai-completions', baseURL: base,
      compat: {supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens'},
      retryPolicy: {mode: 'normal', maxRetries: 1},
      models: [{id: model, name: model, input: ['text'], contextWindow: context, maxTokens}],
    }}}},
    {id: 'agent-default-model', config: {provider: 'self-hosted', model}},
  ];
  const pending = join(state, `.patch-${randomBytes(8).toString('hex')}`);
  writeFileSync(pending, JSON.stringify(patch, null, 2) + '\n', {mode: 0o600});
  renameSync(pending, join(state, 'cordis.patch.yml'));
  console.error(`Harness ${base} -> ${model}; context=${context}, output=${maxTokens}`);
  if (mode === 'check') {
    const chat = async (messages, options = {}) => {
      const response = await api('/chat/completions', {model, messages, max_tokens: maxTokens, ...options});
      if (!options.stream) return (await response.json()).choices[0].message;
      let buffer = '', content = '', reasoning = '', done = false;
      const calls = new Map();
      for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trimEnd(); buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const value = line.slice(5).trim();
          if (value === '[DONE]') {done = true; continue;}
          const event = JSON.parse(value);
          for (const choice of event.choices || []) {
            const delta = choice.delta || {};
            content += delta.content || ''; reasoning += delta.reasoning_content || '';
            for (const part of delta.tool_calls || []) {
              const call = calls.get(part.index) || {id: '', type: 'function', function: {name: '', arguments: ''}};
              call.id += part.id || '';
              call.function.name += part.function?.name || '';
              call.function.arguments += part.function?.arguments || '';
              calls.set(part.index, call);
            }
          }
        }
      }
      if (!done) throw new Error('SSE ended without [DONE]');
      return {role: 'assistant', content: content || null,
        ...(reasoning ? {reasoning_content: reasoning} : {}),
        ...(calls.size ? {tool_calls: [...calls.values()]} : {})};
    };
    const plain = await chat([{role: 'user', content: 'Reply exactly HARNESS_CHAT_OK.'}]);
    if (!plain.content?.includes('HARNESS_CHAT_OK')) throw new Error('Ordinary chat marker missing');
    console.error('PASS ordinary chat');
    const tools = [{type: 'function', function: {name: 'echo_probe', description: 'Return the verification token.',
      parameters: {type: 'object', properties: {}, required: []}}}];
    const messages = [{role: 'user', content: 'Call echo_probe to obtain the token, then reply with its exact value. Do not guess.'}];
    const assistant = await chat(messages, {tools, tool_choice: 'auto', stream: true});
    const calls = assistant.tool_calls || [];
    if (calls.length !== 1 || calls[0].function.name !== 'echo_probe' || !calls[0].id)
      throw new Error('Expected streamed echo_probe call; check server auto-tool-choice/parser');
    JSON.parse(calls[0].function.arguments);
    const token = 'HARNESS_TOOL_' + randomBytes(8).toString('hex');
    messages.push(assistant, {role: 'tool', tool_call_id: calls[0].id, content: token});
    const final = await chat(messages, {tools, stream: true});
    if (!final.content?.includes(token)) throw new Error('Tool-result round trip failed');
    console.error('PASS streamed tool call and tool-result round trip');
  }
  console.log(state);
} catch (error) {console.error(`connect: ${error.message}`); process.exit(1);}
JS
)
export DSH_HOME="$CONNECTION"
case "$MODE" in
  check|install-only) status '[4/4] Ready'; printf 'Ready. Configuration: %s\n' "$DSH_HOME" ;;
  run) status '[4/4] Starting headless task'; direct "$CLI" headless "$TASK" ;;
  web) status '[4/4] Starting Web UI; wait for the URL below'; direct "$CLI" web ${WEB_ARGS[@]+"${WEB_ARGS[@]}"} ;;
esac
