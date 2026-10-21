import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../connect.sh', import.meta.url));

async function fixture(t, models = [{id: 'demo', max_model_len: 65536}]) {
  const data = await mkdtemp(join(tmpdir(), 'harness-connect-'));
  t.after(() => rm(data, {recursive: true, force: true}));
  const bin = join(data, 'runtime/dsh-0.2.1-rc.2/node_modules/.bin');
  await mkdir(bin, {recursive: true});
  await writeFile(join(bin, 'dsh'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {mode: 0o755});
  const server = createServer((req, res) => {
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
    DSH_VERSION: '0.2.1-rc.2', VLLM_MODEL: '',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1'};
  delete env.DSH_CONTEXT_WINDOW; delete env.DSH_MAX_TOKENS;
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

test('rejects invalid model, credentials in URL, and invalid output budget', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(['--model', 'missing', '--install-only']), /Command failed/);
  await assert.rejects(exec('bash', [script, f.endpoint.replace('http://', 'http://user:password@'), '--install-only'], {env: f.env}), error => /without credentials/.test(error.stderr));
  await assert.rejects(exec('bash', [script, f.endpoint, '--install-only'], {env: {...f.env, DSH_MAX_TOKENS: '999999'}}), error => /DSH_MAX_TOKENS/.test(error.stderr));
});
