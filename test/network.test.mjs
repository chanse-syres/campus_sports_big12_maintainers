import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { fetchSourceText, fetchText } from '../src/network.mjs';

const url = 'https://source.example/news';
const options = { allowedHosts: ['source.example'], timeoutMs: 1000 };
const compressors = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync };

function fixture(t, body, headers = {}, { status = 200, addresses = [{ address: '1.1.1.1', family: 4 }] } = {}) {
  const state = { requests: [], responses: [], dnsCalls: 0 };
  t.mock.method(dns, 'lookup', async () => { state.dnsCalls++; return addresses; });
  syncBuiltinESMExports();
  t.mock.method(https, 'get', (destination, settings, callback) => {
    state.requests.push({ destination, settings });
    const response = typeof body === 'function' ? body() : Readable.from(Array.isArray(body) ? body : [body]);
    state.responses.push(response);
    response.headers = { 'content-type': 'text/html; charset=utf-8', ...headers };
    response.statusCode = status;
    const request = new EventEmitter();
    const abort = () => response.destroy(new Error('aborted'));
    settings.signal.addEventListener('abort', abort, { once: true });
    response.once('close', () => settings.signal.removeEventListener('abort', abort));
    queueMicrotask(() => callback(response));
    return request;
  });
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); for (const response of state.responses) response.destroy(); });
  return state;
}

for (const [encoding, compress] of Object.entries(compressors)) {
  test(`fetchText reads valid ${encoding} source responses when a CDN ignores identity`, async t => {
    const html = '<html><h1>Arizona State football — UCF basketball</h1></html>';
    const bytes = compress(html);
    fixture(t, [bytes.subarray(0, 5), bytes.subarray(5)], { 'content-encoding': encoding, 'content-length': String(bytes.length) });
    assert.equal(await fetchText(url, options), html);
  });

  test(`corrupt ${encoding} data fails without retrying or preserving partial HTML`, async t => {
    const state = fixture(t, Buffer.from('not a compressed stream'), { 'content-encoding': encoding });
    await assert.rejects(fetchSourceText(url, options), { code: 'invalid-encoded-response' });
    assert.equal(state.requests.length, 1);
    assert.equal(state.responses[0].destroyed, true);
  });

  test(`truncated ${encoding} data fails even when decompression produced HTML`, async t => {
    const bytes = compress('<html>Must not return a truncated document.</html>');
    fixture(t, bytes.subarray(0, bytes.length - 4), { 'content-encoding': encoding });
    await assert.rejects(fetchText(url, options), { code: 'invalid-encoded-response' });
  });

  test(`${encoding} expansion is bounded independently of compressed wire bytes`, async t => {
    const bytes = compress('<html>' + 'a'.repeat(10_000) + '</html>');
    assert.ok(bytes.length < 256);
    const state = fixture(t, bytes, { 'content-encoding': encoding });
    await assert.rejects(fetchSourceText(url, { ...options, maxBytes: 256 }), { code: 'response-too-large' });
    assert.equal(state.requests.length, 1);
    assert.equal(state.responses[0].destroyed, true);
  });
}

test('encoding tokens are case insensitive and may have surrounding whitespace', async t => {
  fixture(t, gzipSync('valid html'), { 'content-encoding': ' GZip ' });
  assert.equal(await fetchText(url, options), 'valid html');
});

for (const encoding of ['compress', 'zstd', 'gzip, br']) {
  test(`unsupported encoding ${encoding} is rejected without a retry`, async t => {
    const state = fixture(t, Buffer.from('body'), { 'content-encoding': encoding });
    await assert.rejects(fetchSourceText(url, options), { code: 'unexpected-encoding' });
    assert.equal(state.requests.length, 1);
  });
}

test('streamed compressed wire bytes are bounded even when decoded text is smaller', async t => {
  const bytes = gzipSync('small');
  assert.ok(bytes.length > 20);
  const state = fixture(t, [bytes.subarray(0, 15), bytes.subarray(15)], { 'content-encoding': 'gzip' });
  await assert.rejects(fetchText(url, { ...options, maxBytes: 20 }), { code: 'response-too-large' });
  assert.equal(state.responses[0].destroyed, true);
});

test('oversized advertised content length is rejected before reading the body', async t => {
  let read = false;
  fixture(t, () => new Readable({ read() { read = true; this.push(null); } }), { 'content-encoding': 'gzip', 'content-length': '21' });
  await assert.rejects(fetchText(url, { ...options, maxBytes: 20 }), { code: 'response-too-large' });
  assert.equal(read, false);
});

test('a decoded document exactly at its byte limit is accepted', async t => {
  const text = 'a'.repeat(256);
  fixture(t, gzipSync(text), { 'content-encoding': 'gzip' });
  assert.equal(await fetchText(url, { ...options, maxBytes: 256 }), text);
});

test('identity responses retain size and empty-body checks', async t => {
  const state = fixture(t, Buffer.from('abc'), { 'content-encoding': 'identity' });
  assert.equal(await fetchText(url, { ...options, maxBytes: 3 }), 'abc');
  await assert.rejects(fetchText(url, { ...options, maxBytes: 2 }), { code: 'response-too-large' });
  assert.equal(state.responses[1].destroyed, true);
});

test('empty decoded compressed responses are rejected', async t => {
  fixture(t, gzipSync(''), { 'content-encoding': 'gzip' });
  await assert.rejects(fetchText(url, options), { code: 'empty-response' });
});

test('invalid content types and non-success status remain rejected before decoding', async t => {
  const state = fixture(t, gzipSync('body'), { 'content-encoding': 'gzip', 'content-type': 'image/png' });
  await assert.rejects(fetchText(url, options), { code: 'invalid-content-type' });
  assert.equal(state.responses[0].destroyed, true);
});

test('compressed streams remain under the request deadline and are destroyed on timeout', async t => {
  const bytes = gzipSync('a'.repeat(1000));
  const state = fixture(t, () => new Readable({ read() { if (!this.sent) { this.sent = true; this.push(bytes.subarray(0, 10)); } } }), { 'content-encoding': 'gzip' });
  await assert.rejects(fetchText(url, { ...options, timeoutMs: 25 }), { code: 'timeout' });
  assert.equal(state.responses[0].destroyed, true);
});

test('an aborted HTTP stream never returns partial decoded content', async t => {
  const bytes = gzipSync('a'.repeat(1000));
  fixture(t, () => new Readable({ read() { this.push(bytes.subarray(0, 10)); this.destroy(new Error('connection reset')); } }), { 'content-encoding': 'gzip' });
  await assert.rejects(fetchText(url, options), { code: 'network-error' });
});

test('a premature HTTP close is rejected instead of waiting until the deadline', async t => {
  const bytes = gzipSync('a'.repeat(1000));
  fixture(t, () => new Readable({ read() { this.push(bytes.subarray(0, 10)); this.destroy(); } }), { 'content-encoding': 'gzip' });
  await assert.rejects(fetchText(url, options), { code: 'network-error' });
});

test('compressed response support preserves validated DNS pinning and request headers', async t => {
  const state = fixture(t, gzipSync('valid'), { 'content-encoding': 'gzip' });
  assert.equal(await fetchText(url, options), 'valid');
  assert.equal(state.dnsCalls, 1);
  const { settings } = state.requests[0];
  assert.equal(settings.headers['Accept-Encoding'], 'identity');
  assert.equal(settings.headers.Authorization, undefined);
  assert.equal(settings.headers.Cookie, undefined);
  const resolved = await new Promise((resolve, reject) => settings.lookup('source.example', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(resolved, { address: '1.1.1.1', family: 4 });
  assert.equal(state.dnsCalls, 1);
});

test('an allowlisted hostname resolving to a private address is still rejected without requesting', async t => {
  const state = fixture(t, Buffer.from('body'), {}, { addresses: [{ address: '127.0.0.1', family: 4 }] });
  await assert.rejects(fetchText(url, options), { code: 'non-public-address' });
  assert.equal(state.requests.length, 0);
});

test('redirects still require the destination hostname allowlist', async t => {
  const state = fixture(t, Buffer.from(''), { location: 'https://other.example/news' }, { status: 302 });
  await assert.rejects(fetchText(url, options), { code: 'destination-not-allowed' });
  assert.equal(state.requests.length, 1);
});
