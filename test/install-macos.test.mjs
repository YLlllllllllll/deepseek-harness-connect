import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('../install-macos.sh', import.meta.url));

async function fixture(t, installed) {
  const root = await mkdtemp(join(tmpdir(), 'harness-macos-install-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const bin = join(root, 'bin'), app = join(root, 'Applications/Harness Connect.app');
  await mkdir(bin);
  if (installed) {
    await mkdir(join(app, 'Contents'), {recursive:true});
    await writeFile(join(app, 'Contents/Info.plist'), JSON.stringify({CFBundleShortVersionString:installed}));
  }
  const tool = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const name=path.basename(process.argv[1]),args=process.argv.slice(2),env=process.env;
fs.appendFileSync(path.join(env.HOME,'calls'),JSON.stringify({name,args})+'\\n');
if(name==='uname') console.log(args[0]==='-s'?'Darwin':(env.MAC_ARCH||'arm64'));
if(name==='pgrep') process.exit(env.MOCK_RUNNING==='1'||fs.existsSync(path.join(env.HOME,'started-during-download'))?0:1);
if(name==='plutil') {
  try { const obj=JSON.parse(fs.readFileSync(args.at(-1))); if(!obj[args[1]])process.exit(1); console.log(obj[args[1]]); }
  catch {process.exit(1);}
}
if(name==='curl') {
  if(env.MOCK_NETWORK_FAIL==='1') process.exit(22);
  const url=args.find(a=>a.startsWith('https://')), version=env.MOCK_LATEST||'1.2.1';
  if(url.endsWith('/releases/latest')) console.log('https://github.com/YLlllllllllll/deepseek-harness-connect/releases/tag/v'+version);
  else {
    const out=args[args.indexOf('-o')+1], bytes='fixture ZIP bytes';
    const sha=env.MOCK_BAD_SHA==='1'?'0'.repeat(64):crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(out,url.endsWith('SHA256SUMS')?sha+'  Harness-Connect-'+version+'-'+(env.MAC_ARCH==='x86_64'?'x64':'arm64')+'.zip\\n':bytes);
  }
}
if(name==='ditto') {
  if(env.MOCK_START_DURING_DOWNLOAD==='1') fs.writeFileSync(path.join(env.HOME,'started-during-download'),'1');
  const app=path.join(args.at(-1),'Harness Connect.app/Contents');fs.mkdirSync(app,{recursive:true});
  fs.writeFileSync(path.join(app,'Info.plist'),JSON.stringify({CFBundleShortVersionString:env.MOCK_LATEST||'1.2.1',CFBundleIdentifier:'io.github.ylllllllllll.harness-connect'}));
}
if(name==='codesign') process.exit(env.MOCK_BAD_SIGN==='1'?1:0);
if(name==='open') process.exit(env.MOCK_OPEN_FAIL==='1'?1:0);
`;
  for (const name of ['uname','pgrep','plutil','curl','ditto','codesign','open'])
    await writeFile(join(bin,name),tool,{mode:0o755});
  const env={...process.env, HOME:root, PATH:bin+':'+process.env.PATH};
  const run=overrides=>exec('bash',[script],{env:{...env,...overrides},timeout:20000});
  const calls=async()=> (await readFile(join(root,'calls'),'utf8')).trim().split('\n').map(JSON.parse);
  const version=async()=>JSON.parse(await readFile(join(app,'Contents/Info.plist'),'utf8')).CFBundleShortVersionString;
  return {root,app,run,calls,version};
}

test('current App checks metadata and opens without downloading ZIP', async t => {
  const f=await fixture(t,'1.2.1');const result=await f.run();
  assert.match(result.stderr,/skipping App download/);
  const calls=await f.calls();assert.equal(calls.filter(c=>c.name==='curl').length,1);
  assert.ok(calls.some(c=>c.name==='open'));
});
test('newer installed App is never downgraded', async t => {
  const f=await fixture(t,'1.10.0');await f.run({MOCK_LATEST:'1.9.9'});
  assert.equal(await f.version(),'1.10.0');
  assert.equal((await f.calls()).filter(c=>c.name==='curl').length,1);
});
test('old App updates after checksum and signature verification, keeping user settings', async t => {
  const f=await fixture(t,'1.2.0');
  await writeFile(join(f.root,'user-settings'),'saved connections');
  await f.run();assert.equal(await f.version(),'1.2.1');
  assert.equal(await readFile(join(f.root,'user-settings'),'utf8'),'saved connections');
  const calls=await f.calls();
  assert.ok(calls.findIndex(c=>c.name==='codesign')<calls.findIndex(c=>c.name==='open'));
  assert.deepEqual(await readdir(join(f.root,'Applications')),['Harness Connect.app']);
});
test('first install selects Intel asset on x86_64', async t => {
  const f=await fixture(t);await f.run({MAC_ARCH:'x86_64'});
  assert.equal(await f.version(),'1.2.1');
  assert.ok((await f.calls()).some(c=>c.name==='curl'&&c.args.some(a=>a.endsWith('-x64.zip'))));
});
test('checksum failure preserves installed App and releases installer lock', async t => {
  const f=await fixture(t,'1.2.0');
  await assert.rejects(f.run({MOCK_BAD_SHA:'1'}),error=>/checksum mismatch/.test(error.stderr));
  assert.equal(await f.version(),'1.2.0');
  assert.deepEqual(await readdir(join(f.root,'Applications')),['Harness Connect.app']);
});
test('signature failure preserves the installed App', async t => {
  const f=await fixture(t,'1.2.0');await assert.rejects(f.run({MOCK_BAD_SIGN:'1'}));
  assert.equal(await f.version(),'1.2.0');
});
test('network failure falls back to installed App', async t => {
  const f=await fixture(t,'1.2.0');const result=await f.run({MOCK_NETWORK_FAIL:'1'});
  assert.match(result.stderr,/using installed App/);
  assert.ok((await f.calls()).some(c=>c.name==='open'));
});
test('running App is kept active without downloading or replacing it', async t => {
  const f=await fixture(t,'1.2.0');const result=await f.run({MOCK_RUNNING:'1'});
  assert.match(result.stderr,/App is running/);assert.equal(await f.version(),'1.2.0');
  assert.equal((await f.calls()).filter(c=>c.name==='curl').length,1);
});
test('App opened during download is not replaced', async t => {
  const f=await fixture(t,'1.2.0');const result=await f.run({MOCK_START_DURING_DOWNLOAD:'1'});
  assert.match(result.stderr,/App started during download/);assert.equal(await f.version(),'1.2.0');
  assert.deepEqual(await readdir(join(f.root,'Applications')),['Harness Connect.app']);
});
test('failed launch restores the previous App', async t => {
  const f=await fixture(t,'1.2.0');await assert.rejects(f.run({MOCK_OPEN_FAIL:'1'}));
  assert.equal(await f.version(),'1.2.0');
  assert.deepEqual(await readdir(join(f.root,'Applications')),['Harness Connect.app']);
});
test('first-install launch failure retains App for macOS manual approval', async t => {
  const f=await fixture(t);await assert.rejects(f.run({MOCK_OPEN_FAIL:'1'}));
  assert.equal(await f.version(),'1.2.1');
  assert.deepEqual(await readdir(join(f.root,'Applications')),['Harness Connect.app']);
});
