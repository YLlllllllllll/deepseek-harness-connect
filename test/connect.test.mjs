import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../connect.sh', import.meta.url));

async function fixture(t, models = [{id: 'demo', max_model_len: 65536}], badBundle = false) {
  const data = await mkdtemp(join(tmpdir(), 'harness-connect-'));
  t.after(() => rm(data, {recursive: true, force: true}));
  const bin = join(data, 'runtime/dsh-0.2.1-rc.2/node_modules/.bin');
  await mkdir(bin, {recursive: true});
  await writeFile(join(bin, 'dsh'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {mode: 0o755});
  const server = createServer((req, res) => {
    if (badBundle && req.url.endsWith('.tar.gz')) {res.end('invalid runtime bytes'); return;}
    if (req.headers.authorization !== 'Bearer test-secret' || req.url !== '/v1/models') {
      res.writeHead(400); res.end('Unexpected request'); return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({data: models}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = {...process.env, DSH_DATA_DIR: data, VLLM_API_KEY: 'test-secret',
    HOME: data, XDG_DATA_HOME: join(data,'.local/share'), DSH_CLI: '', PATH: dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin',
    DSH_VERSION: '0.2.1-rc.2', VLLM_MODEL: '', DSH_INSTALL_METHOD: 'npm',
    NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1'};
  delete env.DSH_CONTEXT_WINDOW; delete env.DSH_MAX_TOKENS;
  delete env.DSH_BUNDLED_RUNTIME;
  return {data, endpoint, env, run: args => exec('bash', [script, endpoint, ...args], {env, timeout: 15000})};
}

test('normalizes root URL, uses direct model discovery, keeps secrets out of config', async t => {
  const f = await fixture(t);
  const {stdout} = await f.run(['--install-only']);
  assert.match(stdout, /Ready/);
  const dirs = await readdir(join(f.data, 'connections'));
  const text = await readFile(join(f.data, 'connections', dirs[0], 'cordis.patch.yml'), 'utf8');
  assert.ok(!text.includes('test-secret'));
  const patch = JSON.parse(text);
  const route = patch.find(p => p.id === 'llm-pi-ai').config.providers['self-hosted'];
  assert.equal(route.baseURL, f.endpoint + '/v1');
  assert.equal(route.models[0].id, 'demo');
  assert.equal(route.models[0].contextWindow, 65536);
  const second = await exec('bash', [script, f.endpoint + '/v1/', '--install-only'], {env: f.env});
  assert.match(second.stdout, /Ready/);
  assert.equal((await readdir(join(f.data, 'connections'))).length, 1);
});

test('requires explicit selection for multiple models and isolates model connections', async t => {
  const f = await fixture(t, [{id: 'first'}, {id: 'second'}]);
  await assert.rejects(f.run(['--install-only']), error => /Multiple models/.test(error.stderr));
  await f.run(['--model', 'second', '--install-only']);
  await f.run(['--model', 'first', '--install-only']);
  assert.equal((await readdir(join(f.data, 'connections'))).length, 2);
});

test('default forwards Web flags and run mode selects headless', async t => {
  const f = await fixture(t);
  const {stdout} = await f.run(['--no-open', '--port', '3081']);
  assert.equal(stdout, 'web\n--no-open\n--port\n3081\n');
  const task = await f.run(['--run', 'Explain README.md']);
  assert.equal(task.stdout, 'headless\nExplain README.md\n');
});

test('SSH UI installs pinned plugins once, orders bundles, and isolates its profile', async t => {
  const f = await fixture(t);
  const bin = join(f.data, 'runtime/dsh-0.2.1-rc.2/node_modules/.bin');
  await writeFile(join(bin, 'dsh'), `#!/bin/sh
if [ "$1" = plugin ]; then
  echo "$@" >> "$DSH_DATA_DIR/plugin-calls"
  mkdir -p "$DSH_HOME/profiles/web/node_modules/dsh-better-sidebar" "$DSH_HOME/profiles/web/node_modules/@zhangfengshun/dsh-remote-ssh"
  mkdir -p "$DSH_HOME/profiles/web/node_modules/@zhangfengshun/dsh-remote-ssh/lib"
  echo '{"version":"0.28.0"}' > "$DSH_HOME/profiles/web/node_modules/dsh-better-sidebar/package.json"
  echo '{"version":"2.4.36"}' > "$DSH_HOME/profiles/web/node_modules/@zhangfengshun/dsh-remote-ssh/package.json"
  echo '{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@zhangfengshun/dsh-remote-ssh","dsh-better-sidebar"]}}}' > "$DSH_HOME/profiles/web/package.json"
  cat > "$DSH_HOME/profiles/web/node_modules/@zhangfengshun/dsh-remote-ssh/lib/index.js" <<'PLUGIN'
function internal(svc) {return svc.describe({ redactSecrets: true });}
function fixture() {
  const api = {
    listProfiles: () => ({profiles: settingsFace.read().profiles}),
    saveProfile: () => {
      const existing = {}, p = {}, record = {password: p.password || "",}, profiles = [];
      return { ok: true, id: record.id, profiles: profiles };
    },
    deleteProfile: () => {const profiles = [], workspaces = []; return { ok: true, profiles: profiles, workspaces: workspaces };}
  };
  return {api, tool: () => ({profiles: settingsFace.read().profiles})};
}
PLUGIN
fi
`, {mode: 0o755});
  await writeFile(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  f.env.PATH = bin + ':' + f.env.PATH;
  await f.run(['--install-only']);
  await f.run(['--remote-ssh', '--install-only']);
  const {stderr} = await f.run(['--remote-ssh', '--install-only']);
  assert.match(stderr, /Settings > Remote SSH/);
  const dirs = await readdir(join(f.data, 'connections'));
  assert.equal(dirs.length, 2);
  const calls = await readFile(join(f.data, 'plugin-calls'), 'utf8');
  assert.equal(calls.trim().split('\n').length, 1);
  assert.match(calls, /dsh-better-sidebar@0.28.0/);
  assert.match(calls, /@zhangfengshun\/dsh-remote-ssh@2.4.36/);
  for (const dir of dirs) {
    try {
      const profile = JSON.parse(await readFile(join(f.data, 'connections', dir, 'profiles/web/package.json'), 'utf8'));
      assert.deepEqual(profile.dsh.profile.bundles.slice(-2), ['dsh-better-sidebar', '@zhangfengshun/dsh-remote-ssh']);
      const patched = await readFile(join(f.data, 'connections', dir, 'profiles/web/node_modules/@zhangfengshun/dsh-remote-ssh/lib/index.js'), 'utf8');
      assert.match(patched, /^\/\/ harness-connect-password-v1/);
      assert.match(patched, /redactSecrets: false/);
      assert.equal(patched.match(/profiles: publicProfiles/g).length, 4);
      const patch = JSON.parse(await readFile(join(f.data, 'connections', dir, 'cordis.patch.yml'), 'utf8'));
      const terminal = patch.find(p => p.id === 'terminal-controller').config.shell.args[0];
      await exec(process.execPath, ['--check', terminal]);
      const cwd = join(f.data, 'password-workspace');
      await mkdir(cwd);
      await writeFile(join(cwd, '.remote-ssh.json'), JSON.stringify({host:'example.invalid', user:'demo', remotePath:"/tmp/a b/'$(touch nope)", keyPath:''}));
      await writeFile(join(bin, 'ssh'), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', {mode: 0o755});
      const opened = await exec(process.execPath, [terminal], {env:f.env, cwd});
      const args = JSON.parse(opened.stdout);
      assert.ok(args.includes('demo@example.invalid'));
      assert.ok(!args.includes('-i'));
      assert.match(args.at(-1), /^cd -- '/);
      assert.match(args.at(-1), /'\\''\$\(touch nope\)'/);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await assert.rejects(f.run(['--remote-ssh', '--run', 'task']), error => /requires web/.test(error.stderr));
});

test('rejects invalid model, credentials in URL, and invalid output budget', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(['--model', 'missing', '--install-only']), /Command failed/);
  await assert.rejects(exec('bash', [script, f.endpoint.replace('http://', 'http://user:password@'), '--install-only'], {env: f.env}), error => /without credentials/.test(error.stderr));
  await assert.rejects(exec('bash', [script, f.endpoint, '--install-only'], {env: {...f.env, DSH_MAX_TOKENS: '999999'}}), error => /DSH_MAX_TOKENS/.test(error.stderr));
});

async function mockInstall(f, fail = false) {
  await rm(join(f.data, 'runtime'), {recursive: true});
  const bin = join(f.data, 'mock-bin');
  await mkdir(bin);
  await writeFile(join(bin, 'npm'), `#!/bin/sh
prefix=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then prefix=$2; shift; fi
  shift
done
echo 'npm http fetch GET 200 https://example.invalid/mock-package'
sleep 1
${fail ? "echo 'mock registry failure' >&2; exit 23" : `mkdir -p "$prefix/node_modules/.bin"
printf '#!/bin/sh\\necho 0.2.1-rc.2\\n' > "$prefix/node_modules/.bin/dsh"
chmod +x "$prefix/node_modules/.bin/dsh"
echo 'added 1 mock package'`}
`, {mode: 0o755});
  f.env.PATH = bin + ':' + f.env.PATH;
}

test('reuses a compatible dsh on PATH without downloading another runtime', async t => {
  const f = await fixture(t);
  await rm(join(f.data, 'runtime'), {recursive:true});
  const bin = join(f.data, 'existing-bin'); await mkdir(bin);
  await writeFile(join(bin, 'dsh'), '#!/bin/sh\nif [ "$1" = --version ]; then echo 0.2.1-rc.2; else printf "%s\\n" "$@"; fi\n', {mode:0o755});
  f.env.PATH = bin + ':' + f.env.PATH;
  const result = await f.run(['--no-open']);
  assert.match(result.stderr, /Reusing compatible local dsh/);
  assert.equal(result.stdout, 'web\n--no-open\n');
  assert.ok(!(await readdir(f.data)).includes('runtime'));
});

test('reuses shared CLI runtime when the App uses a different data directory', async t => {
  const f = await fixture(t);
  await rm(join(f.data, 'runtime'), {recursive:true});
  const bin = join(f.data, '.local/share/deepseek-harness-connect/runtime/dsh-0.2.1-rc.2/node_modules/.bin');
  await mkdir(bin, {recursive:true});
  await writeFile(join(bin, 'dsh'), '#!/bin/sh\necho 0.2.1-rc.2\n', {mode:0o755});
  const result = await f.run(['--install-only']);
  assert.match(result.stderr, /Reusing compatible local dsh/);
  assert.ok(!(await readdir(f.data)).includes('runtime'));
});

test('desktop bundle uses shipped Node and Harness with no runtime download', async t => {
  const f=await fixture(t);await rm(join(f.data,'runtime'),{recursive:true});
  const root=join(f.data,'desktop-runtime');await mkdir(join(root,'node/bin'),{recursive:true});
  await symlink(process.execPath,join(root,'node/bin/node'));
  await symlink(join(dirname(process.execPath),'npm'),join(root,'node/bin/npm'));
  const bin=join(root,'harness/node_modules/.bin');await mkdir(bin,{recursive:true});
  await writeFile(join(bin,'dsh'),'#!/bin/sh\necho 0.2.1-rc.2\n',{mode:0o755});
  const pnpm=join(root,'pnpm/node_modules/.bin');await mkdir(pnpm,{recursive:true});
  await writeFile(join(pnpm,'pnpm'),'#!/bin/sh\nexit 91\n',{mode:0o755});
  const manifest={schema:1,platform:process.platform,arch:process.arch,node:process.versions.node,nodeAbi:process.versions.modules,harness:'0.2.1-rc.2'};
  await writeFile(join(root,'BUNDLE.json'),JSON.stringify(manifest));f.env.DSH_BUNDLED_RUNTIME=root;
  const result=await f.run(['--install-only']);assert.match(result.stderr,/no dependency downloads/);
  assert.ok(!(await readdir(f.data)).includes('runtime'));
  await mkdir(join(root,'web-profile'));await writeFile(join(root,'web-profile/package.json'),'{}');
  for(let attempt=0;attempt<2;attempt++)await assert.rejects(f.run(['--remote-ssh','--install-only']),error=>
    /SSH profile is incomplete or incompatible/.test(error.stderr)&&!/Installing .*plugins|Downloading /.test(error.stderr));
  await writeFile(join(root,'BUNDLE.json'),JSON.stringify({...manifest,platform:'wrong'}));
  await assert.rejects(f.run(['--install-only']),error=>/platform\/version mismatch/.test(error.stderr));
});

test('reuses the shared Node installation when Node on PATH is incompatible', async t => {
  const f = await fixture(t);
  const bin = join(f.data, 'old-node-bin');await mkdir(bin);
  await writeFile(join(bin,'node'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  await writeFile(join(bin,'npm'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const shared = join(f.data, `.local/share/deepseek-harness-connect/tools/node-v24.15.0-${process.platform}-${process.arch}/bin`);
  await mkdir(shared,{recursive:true});
  await symlink(process.execPath,join(shared,'node'));
  await symlink(join(dirname(process.execPath),'npm'),join(shared,'npm'));
  f.env.PATH=bin+':'+f.env.PATH;f.env.DSH_NODE_VERSION='24.15.0';
  const result=await f.run(['--install-only']);
  assert.match(result.stderr,/Node.js v/);
  assert.ok(!result.stderr.includes('Downloading node-'));
  assert.ok(!(await readdir(f.data)).includes('tools'));
});

test('incompatible external dsh is preserved while the required version installs separately', async t => {
  const f = await fixture(t);
  await mockInstall(f);
  const old = join(f.data, 'mock-bin/dsh');
  await writeFile(old, '#!/bin/sh\necho 0.1.0\n', {mode:0o755});
  const result = await f.run(['--install-only']);
  assert.match(result.stderr, /Installing Harness/);
  assert.equal((await exec(old, ['--version'])).stdout.trim(), '0.1.0');
  assert.ok((await readdir(join(f.data, 'runtime'))).includes('dsh-0.2.1-rc.2'));
});

test('fresh installation reports stages and elapsed progress and preserves its npm log', async t => {
  const f = await fixture(t);
  await mockInstall(f);
  const {stderr} = await f.run(['--install-only']);
  assert.match(stderr, /\[1\/4\].*Node/);
  assert.match(stderr, /\[2\/4\] npm: \d+s elapsed; \d+ HTTP\/cache operations completed/);
  assert.match(stderr, /\[2\/4\] npm completed/);
  assert.match(stderr, /\[3\/4\].*discovering models/);
  assert.match(stderr, /\[4\/4\] Ready/);
  const log = await readFile(join(f.data, 'runtime/dsh-0.2.1-rc.2/npm-install.log'), 'utf8');
  assert.match(log, /added 1 mock package/);
});

test('npm failures print their log and release the installer lock', async t => {
  const f = await fixture(t);
  await mockInstall(f, true);
  await assert.rejects(f.run(['--install-only']), error => {
    assert.match(error.stderr, /mock registry failure/);
    assert.match(error.stderr, /npm install failed \(exit 23\)/);
    return true;
  });
  assert.deepEqual(await readdir(join(f.data, 'runtime')), []);
});

const fastProfile = process.platform === 'linux' && process.arch === 'x64' &&
  process.versions.node.startsWith('24.') && process.versions.modules === '137' &&
  !!process.report.getReport().header.glibcVersionRuntime;

test('auto mode falls back to npm when the runtime download is unavailable', {skip: !fastProfile}, async t => {
  const f = await fixture(t);
  await mockInstall(f);
  f.env.DSH_INSTALL_METHOD = 'auto';
  f.env.DSH_RUNTIME_BASE_URL = f.endpoint;
  const {stderr} = await f.run(['--install-only']);
  assert.match(stderr, /falling back to npm/);
  assert.match(stderr, /npm completed/);
});

test('rejects corrupt runtime before extraction and never silently falls back on a checksum failure', {skip: !fastProfile}, async t => {
  const f = await fixture(t, [{id: 'demo'}], true);
  await rm(join(f.data, 'runtime'), {recursive: true});
  f.env.DSH_INSTALL_METHOD = 'auto';
  f.env.DSH_RUNTIME_BASE_URL = f.endpoint;
  await assert.rejects(f.run(['--install-only']), error => {
    assert.match(error.stderr, /Prebuilt runtime checksum mismatch/);
    assert.doesNotMatch(error.stderr, /Installing Harness/);
    return true;
  });
  assert.deepEqual(await readdir(join(f.data, 'runtime')), []);
});
