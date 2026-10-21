'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { options, harnessUrl } = require('./desktop.cjs');

let setup, harness, servers, child, starting = false, quitting = false;
const setupUrl = pathToFileURL(join(__dirname, 'setup.html')).href;
const serversUrl = pathToFileURL(join(__dirname, 'servers.html')).href;
const settingsFile = () => join(app.getPath('userData'), 'connection.json');
const uiTest = process.argv.includes('--ui-test');
const backendLog = [];
if (uiTest) {
  const home=process.env.HARNESS_UI_HOME;
  if (!home) throw new Error('UI test requires its isolated fixture home');
  fs.mkdirSync(join(home,'app-data'),{recursive:true});
  app.setPath('home',home); app.setPath('userData',join(home,'app-data'));
}

function send(text) {
  if (setup && !setup.isDestroyed()) setup.webContents.send('progress', text);
}
function stopLocal() {
  if (child) {
    // Only the process group created by this app; never remote service management.
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    child = undefined;
  }
}
function openExternal(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch {}
}
function protect(window, allowed) {
  window.webContents.setWindowOpenHandler(({url}) => {
    if(window===harness && url.replace(/\/$/,'')==='harness-connect://remote-servers') showServers();
    else openExternal(url);
    return {action: 'deny'};
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function showServers() {
  if(!harness || harness.isDestroyed()) { dialog.showMessageBox({message:'请先连接模型 endpoint，再添加远程服务器。'}); return; }
  if(servers && !servers.isDestroyed()) { servers.show();servers.focus();return; }
  servers=new BrowserWindow({width:760,height:940,title:'远程服务器',webPreferences:{preload:join(__dirname,'servers-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(uiTest)servers.webContents.on('console-message',(_event,...args)=>console.log('SERVER UI',...args));
  protect(servers,url=>url===serversUrl);servers.loadURL(serversUrl);
  servers.on('closed',()=>{servers=undefined;});
}
function installRemoteAction(window) {
  return window.webContents.executeJavaScript(`(()=>{
    if(document.getElementById('connect-remote-servers'))return;
    const button=document.createElement('button');button.id='connect-remote-servers';
    button.textContent='远程服务器';button.setAttribute('aria-label','远程服务器');
    button.style.cssText='position:fixed;top:12px;right:16px;z-index:2147483647;padding:9px 16px;border:1px solid #c6d2e3;border-radius:8px;background:#fff;color:#173965;font:14px -apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px #0001';
    button.onclick=()=>window.open('harness-connect://remote-servers');document.body.append(button);
  })()`);
}
function showSetup() {
  if (setup && !setup.isDestroyed()) { setup.show(); setup.focus(); return; }
  setup = new BrowserWindow({width: 720, height: 760, title: 'Harness Connect · 连接设置',
    webPreferences: {preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  protect(setup, url => url === setupUrl);
  setup.loadURL(setupUrl);
  setup.on('closed', () => { setup = undefined; });
}
function trusted(event, window=setup, url=setupUrl) {
  if (!window || event.sender !== window.webContents || event.senderFrame.url !== url)
    throw new Error('Invalid settings caller');
}

app.requestSingleInstanceLock() || app.quit();
app.on('second-instance', () => {
  const window = harness || setup;
  if (window && !window.isDestroyed()) { window.show(); window.focus(); }
});
app.whenReady().then(() => {
  const methods=new Set(['listProfiles','saveProfile','testConnection','listDir','createRemoteWorkspace']);
  ipcMain.handle('servers:request',async(event,method,args={})=>{
    trusted(event,servers,serversUrl);
    if(!methods.has(method))return {ok:false,error:'不支持的服务器操作'};
    if(!harness||harness.isDestroyed())return {ok:false,error:'模型连接已关闭，请先重新连接'};
    try {
      const origin=new URL(harness.webContents.getURL()).origin;
      const response=await harness.webContents.session.fetch(origin+'/remote-ssh/api/'+method,{
        method:'POST',credentials:'include',redirect:'error',
        headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest','origin':origin},body:JSON.stringify(args),
      });
      const result=await response.json();
      const value=result.ok?result.value:{ok:false,error:result.error?.message||'远程服务器模块未就绪'};
      if(value.ok&&method==='createRemoteWorkspace') setTimeout(()=>{if(harness&&!harness.isDestroyed())harness.reload();},0);
      return value;
    }catch{return {ok:false,error:'远程服务器模块未就绪，请检查本地服务后重试'};}
  });
  ipcMain.handle('defaults', event => {
    trusted(event);
    try { const saved = JSON.parse(fs.readFileSync(settingsFile())); return {endpoint: saved.endpoint, model: saved.model, proxy: saved.proxy}; }
    catch { return {}; }
  });
  ipcMain.handle('connect', async (event, input) => {
    trusted(event);
    if (starting) return {error: '正在启动，请稍候'};
    let value;
    try { value = options(input); } catch (error) { return {error: error.message}; }
    if (child && dialog.showMessageBoxSync(setup, {type: 'question', buttons: ['取消', '切换连接'],
      defaultId: 0, message: '切换将关闭当前本地 agent 服务，正在进行的任务会中断。'}) !== 1)
      return {error: '已保留当前连接'};
    stopLocal();
    if(servers&&!servers.isDestroyed())servers.close();
    if (harness && !harness.isDestroyed()) { harness.removeAllListeners('closed'); harness.destroy(); }
    harness = undefined;
    starting = true;
    try {
    const {apiKey, ...saved} = value;
    fs.mkdirSync(app.getPath('userData'), {recursive: true, mode: 0o700});
    fs.writeFileSync(settingsFile(), JSON.stringify(saved, null, 2), {mode: 0o600});
    const script = app.isPackaged ? join(process.resourcesPath, 'connect.sh') : join(__dirname, '..', 'connect.sh');
    const runtime=app.isPackaged?join(process.resourcesPath,'runtime'):join(__dirname,'runtime');
    if(!fs.existsSync(join(runtime,'BUNDLE.json')))throw new Error('安装包缺少内置运行时，请重新安装完整 App');
    const args = [script, value.endpoint, '--remote-ssh', '--no-open', '--port', '0'];
    if (value.model) args.push('--model', value.model);
    const env = {...process.env, PATH: join(app.getPath('home'), '.local/bin') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      HOME:app.getPath('home'),DSH_BUNDLED_RUNTIME:runtime,
      DSH_DATA_DIR: join(app.getPath('userData'), 'harness'), VLLM_API_KEY: apiKey || 'internal-no-auth'};
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
    if (value.proxy) env.https_proxy = value.proxy;
    send('正在使用内置运行时连接模型；无需下载 Node、npm 或 SSH 插件。');
    const running = spawn('/bin/bash', args, {env, cwd: app.getPath('home'), detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    child = running;
    let partial = '';
    const output = buffer => {
      partial += buffer.toString();
      const lines = partial.split(/[\r\n]+/); partial = lines.pop();
      for (const line of lines) {
        if(uiTest)backendLog.push(line);
        const url = harnessUrl(line);
        if (url && !harness) {
          starting = false;
          harness = new BrowserWindow({width: 1360, height: 900, title: 'Harness Connect',
            webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true}});
          const origin = new URL(url).origin;
          protect(harness, next => { try { return new URL(next).origin === origin; } catch { return false; } });
          const current=harness;
          current.webContents.on('did-finish-load',()=>{installRemoteAction(current).catch(()=>send('远程入口加载失败，可从菜单打开远程服务器。'));});
          harness.loadURL(url).then(() => { if (setup && !setup.isDestroyed()) setup.hide(); }).catch(error => {
            showSetup(); send('界面加载失败：' + error.message);
          });
          harness.on('closed', () => { harness = undefined; stopLocal(); app.quit(); });
          send('已就绪。点击主窗口右上角“远程服务器”添加 SSH 连接。');
        } else if (line && !line.includes('?token=')) {
          // API credentials stay in environment; never echo a token-bearing URL.
          send(apiKey ? line.split(apiKey).join('[redacted]') : line);
        }
      }
    };
    running.stdout.on('data', output); running.stderr.on('data', output);
    running.on('error', error => { starting = false; send('启动失败：' + error.message); });
    running.on('exit', code => {
      if (child !== running) return;
      child = undefined; starting = false;
      if (!quitting) { showSetup(); send(`本地服务已退出（${code ?? 'signal'}）。可检查连接后重试。`); }
    });
    return {ok: true};
    } catch (error) {
      starting = false; stopLocal();
      return {error: '启动失败：' + error.message};
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: 'Harness Connect', submenu: [
      {label: '模型连接设置…', click: showSetup}, {type: 'separator'}, {role: 'quit'}]},
    {label:'远程服务器',submenu:[{label:'添加或管理服务器…',click:showServers}]},
    {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
  ]));
  showSetup();
  if(uiTest) {
    require('./ui-check.cjs')({setup,getHarness:()=>harness,getServers:()=>servers,backendLog,stopLocal})
      .then(()=>app.exit(0)).catch(error=>{console.error(error);stopLocal();app.exit(1);});
  }
  if (process.argv.includes('--smoke-test')) {
    setup.webContents.once('did-finish-load', async () => {
      try {
        const fields = await setup.webContents.executeJavaScript(`Promise.all([
          window.connectApp.defaults(),
          Promise.resolve(['endpoint','model','apiKey','proxy','start'].every(id => !!document.getElementById(id)))
        ])`);
        if (!fields[1]) throw new Error('Missing connection form fields');
        console.log('PASS desktop settings window, preload and IPC'); app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
    setTimeout(() => app.exit(1), 30000).unref();
  }
});
app.on('activate', () => { if (!harness && !setup) showSetup(); });
app.on('before-quit', () => { quitting = true; stopLocal(); });
app.on('window-all-closed', () => app.quit());
