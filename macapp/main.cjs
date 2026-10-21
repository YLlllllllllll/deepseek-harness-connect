'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { options, harnessUrl } = require('./desktop.cjs');

let setup, harness, child, starting = false, quitting = false;
const setupUrl = pathToFileURL(join(__dirname, 'setup.html')).href;
const settingsFile = () => join(app.getPath('userData'), 'connection.json');

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
  window.webContents.setWindowOpenHandler(({url}) => { openExternal(url); return {action: 'deny'}; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function showSetup() {
  if (setup && !setup.isDestroyed()) { setup.show(); setup.focus(); return; }
  setup = new BrowserWindow({width: 720, height: 760, title: 'Harness Connect · 连接设置',
    webPreferences: {preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  protect(setup, url => url === setupUrl);
  setup.loadURL(setupUrl);
  setup.on('closed', () => { setup = undefined; });
}
function trusted(event) {
  if (!setup || event.sender !== setup.webContents || event.senderFrame.url !== setupUrl)
    throw new Error('Invalid settings caller');
}

app.requestSingleInstanceLock() || app.quit();
app.on('second-instance', () => {
  const window = harness || setup;
  if (window && !window.isDestroyed()) { window.show(); window.focus(); }
});
app.whenReady().then(() => {
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
    if (harness && !harness.isDestroyed()) { harness.removeAllListeners('closed'); harness.destroy(); }
    harness = undefined;
    starting = true;
    try {
    const {apiKey, ...saved} = value;
    fs.mkdirSync(app.getPath('userData'), {recursive: true, mode: 0o700});
    fs.writeFileSync(settingsFile(), JSON.stringify(saved, null, 2), {mode: 0o600});
    const script = app.isPackaged ? join(process.resourcesPath, 'connect.sh') : join(__dirname, '..', 'connect.sh');
    const args = [script, value.endpoint, '--remote-ssh', '--no-open', '--port', '0'];
    if (value.model) args.push('--model', value.model);
    const env = {...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      DSH_DATA_DIR: join(app.getPath('userData'), 'harness'), VLLM_API_KEY: apiKey || 'internal-no-auth'};
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
    if (value.proxy) env.https_proxy = value.proxy;
    send('准备本地运行时和 SSH 插件；首次启动会下载依赖。');
    const running = spawn('/bin/bash', args, {env, cwd: app.getPath('home'), detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    child = running;
    let partial = '';
    const output = buffer => {
      partial += buffer.toString();
      const lines = partial.split(/[\r\n]+/); partial = lines.pop();
      for (const line of lines) {
        const url = harnessUrl(line);
        if (url && !harness) {
          starting = false;
          harness = new BrowserWindow({width: 1360, height: 900, title: 'Harness Connect',
            webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true}});
          const origin = new URL(url).origin;
          protect(harness, next => { try { return new URL(next).origin === origin; } catch { return false; } });
          harness.loadURL(url).then(() => { if (setup && !setup.isDestroyed()) setup.hide(); }).catch(error => {
            showSetup(); send('界面加载失败：' + error.message);
          });
          harness.on('closed', () => { harness = undefined; stopLocal(); app.quit(); });
          send('已就绪。Settings → Remote SSH 添加主机，Add Workspace 选择远程目录。');
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
      {label: '连接设置…', click: showSetup}, {type: 'separator'}, {role: 'quit'}]},
    {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
  ]));
  showSetup();
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
