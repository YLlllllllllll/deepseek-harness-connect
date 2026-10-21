const {test} = require('node:test');
const assert = require('node:assert/strict');
const {options, harnessUrl} = require('../macapp/desktop.cjs');

test('desktop accepts arbitrary endpoint, IPv6, optional model and download proxy', () => {
  assert.equal(options({endpoint: 'http://[::1]:8000/v1'}).endpoint, 'http://[::1]:8000/v1');
  const value = options({endpoint:'https://models.example/v1', model:' my-model ', proxy:'http://proxy.example:8118', apiKey:'session-secret'});
  assert.equal(value.model, 'my-model');
  assert.equal(value.apiKey, 'session-secret');
  assert.equal(value.proxy, 'http://proxy.example:8118');
});
test('desktop rejects credentials, query tokens and non-HTTP configuration URLs', () => {
  for (const endpoint of ['file:///etc/passwd', 'https://user:secret@host/v1', 'https://host/v1?api_key=secret'])
    assert.throws(() => options({endpoint}));
  assert.throws(() => options({endpoint:'http://localhost:8000', proxy:'socks5://localhost:1080'}));
});
test('desktop opens only the local authenticated Harness URL announced by its own child', () => {
  assert.equal(harnessUrl('dsh web: http://127.0.0.1:32100/?token=abc_-123'), 'http://127.0.0.1:32100/?token=abc_-123');
  for (const text of ['http://127.0.0.1:32100/?token=abc', 'dsh web: http://evil.example/?token=abc', 'dsh web: file:///etc/passwd'])
    assert.equal(harnessUrl(text), null);
});
