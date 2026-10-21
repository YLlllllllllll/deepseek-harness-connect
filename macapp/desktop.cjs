'use strict';
// Pure validation helpers, shared by the app and its platform-independent tests.
function options(input) {
  const parse = (value, label, optional = false) => {
    const text = String(value || '').trim();
    if (optional && !text) return '';
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error(`${label} 需为 HTTP(S) 地址，不包含账号、密码或查询参数`);
    return text;
  };
  return {
    endpoint: parse(input.endpoint, 'Endpoint'),
    proxy: parse(input.proxy, '下载代理', true),
    model: String(input.model || '').trim(),
    apiKey: String(input.apiKey || ''),
  };
}

function harnessUrl(line) {
  const match = line.match(/^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)\s*$/);
  return match ? match[1] : null;
}
module.exports = { options, harnessUrl };
