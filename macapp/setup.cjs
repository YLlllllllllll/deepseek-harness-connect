window.connectApp.defaults().then(value => {
  for (const key of ['endpoint', 'model', 'proxy']) document.getElementById(key).value = value[key] || '';
});
window.connectApp.onProgress(text => {
  const log = document.getElementById('progress');
  log.textContent = (log.textContent + '\n' + text).slice(-12000);
  log.scrollTop = log.scrollHeight;
  if (text.includes('失败') || text.includes('已退出') || text.includes('已就绪')) document.getElementById('start').disabled = false;
});
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('start'); button.disabled = true;
  const value = Object.fromEntries(['endpoint', 'model', 'apiKey', 'proxy'].map(key => [key, document.getElementById(key).value]));
  try {
    const result = await window.connectApp.connect(value);
    if (result.error) { document.getElementById('progress').textContent = result.error; button.disabled = false; }
  } catch {
    document.getElementById('progress').textContent = '启动失败，请重新打开连接设置后重试。';
    button.disabled = false;
  }
});
