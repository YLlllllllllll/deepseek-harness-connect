const fs=require('node:fs');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,timeout=45000){const start=Date.now();while(Date.now()-start<timeout){try{const value=await fn();if(value)return value;}catch{}await delay(100);}throw new Error('UI check timeout: '+label);}
module.exports=async({setup,getHarness,getServers,backendLog,stopLocal})=>{
  await waitFor(()=>setup.webContents.executeJavaScript(`!!document.getElementById('form')`),'connection form');
  const endpoint=process.env.HARNESS_UI_ENDPOINT;
  assert.equal(new URL(endpoint).hostname,'127.0.0.1');
  const started=performance.now();
  await setup.webContents.executeJavaScript(`document.getElementById('endpoint').value=${JSON.stringify(endpoint)};document.getElementById('form').requestSubmit()`);
  const window=await waitFor(async()=>{const w=getHarness();return w&&await w.webContents.executeJavaScript(`!!document.getElementById('connect-remote-servers')`)?w:null;},'visible remote-server action');
  const readyMs=performance.now()-started;
  await window.webContents.executeJavaScript(`document.getElementById('connect-remote-servers').click()`);
  const remote=await waitFor(async()=>{const w=getServers();return w&&await w.webContents.executeJavaScript(`!!document.getElementById('server-form')`)?w:null;},'remote-server form');
  const data={name:'UI fixture server',host:'127.0.0.1',port:process.env.HARNESS_UI_SSH_PORT,user:'fixture',password:process.env.HARNESS_UI_PASSWORD,remoteRoot:process.env.HARNESS_UI_PROJECT};
  await remote.webContents.executeJavaScript(`(()=>{const data=${JSON.stringify(data)};for(const [key,value] of Object.entries(data))document.getElementById(key).value=value;document.getElementById('server-form').requestSubmit()})()`);
  try { await waitFor(()=>remote.webContents.executeJavaScript(`document.getElementById('servers').textContent.includes('UI fixture server')`),'saved server card'); }
  catch(error) { console.error(await remote.webContents.executeJavaScript(`document.body.innerText`));throw error; }
  const publicList=await remote.webContents.executeJavaScript(`window.remoteServers.request('listProfiles')`);
  assert.equal(publicList.profiles.length,1);assert.equal(publicList.profiles[0].password,'');
  await remote.webContents.executeJavaScript(`document.querySelector('[data-action="test"]').click()`);
  await waitFor(()=>remote.webContents.executeJavaScript(`document.getElementById('status').textContent.startsWith('连接成功')`),'real SSH password authentication');
  await remote.webContents.executeJavaScript(`document.querySelector('[data-action="workspace"]').click()`);
  await waitFor(()=>remote.webContents.executeJavaScript(`document.getElementById('status').textContent.startsWith('工作区已添加')`),'remote workspace creation');
  await waitFor(()=>window.webContents.executeJavaScript(`document.body.innerText.includes('fixture-project')`),'workspace visible in main window');
  assert.ok(!backendLog.some(line=>/^connect: (Downloading |Installing |\[2\/4\] (Installing |Downloading ))/.test(line)),'desktop must not download/install dependencies after endpoint input');
  if(process.env.HARNESS_UI_CAPTURE)fs.writeFileSync(process.env.HARNESS_UI_CAPTURE,(await remote.webContents.capturePage()).toPNG());
  if(process.env.HARNESS_UI_REPORT)fs.writeFileSync(process.env.HARNESS_UI_REPORT,JSON.stringify({readyMs,visibleRemoteEntry:true,savedServer:true,passwordSsh:true,workspaceVisible:true,dependencyDownloads:0},null,2));
  console.log(`PASS full UI: visible entry, save server, password SSH, workspace; endpoint-to-window ${Math.round(readyMs)}ms; no dependency downloads`);
  stopLocal();
};
