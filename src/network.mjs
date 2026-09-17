import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { safeUrl } from './normalize.mjs';

export class SourceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function assertAllowedUrl(value, allowedHosts) {
  const normalized = safeUrl(value);
  if (!normalized || !allowedHosts.includes(new URL(normalized).hostname)) throw new SourceError('destination-not-allowed');
  return new URL(normalized);
}

// Retry transient transport/server failures once. Access denials and rate limits
// are returned immediately and never trigger alternative endpoints or proxies.
export async function fetchSourceText(value, options, { request = fetchText, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  try { return await request(value, options); } catch (error) {
    if (!(error instanceof SourceError) || !['timeout', 'network-error', 'http-502', 'http-503', 'http-504'].includes(error.code)) throw error;
    await pause(1000);
    return request(value, options);
  }
}

// DNS is resolved once, checked, and pinned into the TLS connection lookup. No proxies or cookies.
export async function fetchText(value, { allowedHosts, maxBytes = 4_000_000, timeoutMs = 20_000, redirects = 2 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new SourceError('timeout')), { once: true }));
  try {
    return await Promise.race([request(value, redirects), aborted]);
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(controller.signal.aborted ? 'timeout' : 'network-error');
  } finally { clearTimeout(timeout); }

  async function request(destination, remaining) {
    const url = assertAllowedUrl(destination, allowedHosts);
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new SourceError('non-public-address');
    controller.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CampusSportsHQ-Big12Maintainer/1.0 (+https://github.com/chanse-syres/campus_sports_big12_maintainers)', Accept: 'application/json,text/html,application/xml,text/xml', 'Accept-Encoding': 'identity' },
        lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.destroy();
          if (!remaining || !res.headers.location) return reject(new SourceError('redirect-limit'));
          try { resolve(request(new URL(res.headers.location, url).href, remaining - 1)); } catch { reject(new SourceError('invalid-redirect')); }
          return;
        }
        if (res.statusCode !== 200) { res.destroy(); reject(new SourceError(`http-${res.statusCode}`)); return; }
        if (!/\b(json|html|xml|plain)\b/i.test(res.headers['content-type'] || '')) { res.destroy(); reject(new SourceError('invalid-content-type')); return; }
        readResponseText(res, maxBytes, controller.signal).then(resolve, reject);
      });
      req.on('error', reject);
    });
  }
}

async function readResponseText(response, maxBytes, signal) {
  const encoding = String(response.headers['content-encoding'] || 'identity').trim().toLowerCase();
  const decoders = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
  if (encoding !== 'identity' && !Object.hasOwn(decoders, encoding)) {
    response.destroy();
    throw new SourceError('unexpected-encoding');
  }
  if (Number(response.headers['content-length']) > maxBytes) {
    response.destroy();
    throw new SourceError('response-too-large');
  }

  // A CDN may ignore Accept-Encoding: identity. Bound both wire bytes and the
  // decoded document, with backpressure and the original whole-request deadline.
  let wireBytes = 0; let decodedBytes = 0; let failureOrigin;
  const chunks = [];
  const wireLimit = new Transform({
    transform(chunk, _encoding, callback) {
      wireBytes += chunk.length;
      callback(wireBytes > maxBytes ? new SourceError('response-too-large') : null, chunk);
    },
  });
  const collector = new Writable({
    write(chunk, _encoding, callback) {
      decodedBytes += chunk.length;
      if (decodedBytes > maxBytes) return callback(new SourceError('response-too-large'));
      chunks.push(chunk);
      callback();
    },
  });
  const decoder = encoding === 'identity' ? null : decoders[encoding]();
  // pipeline propagates an error to every stream when destroying the chain;
  // retain its origin so transport failures keep their existing retry policy.
  response.on('error', () => { failureOrigin ??= 'response'; });
  response.once('close', () => { if (!response.readableEnded) failureOrigin ??= 'response'; });
  decoder?.on('error', () => { failureOrigin ??= 'decoder'; });
  try {
    await pipeline(response, wireLimit, ...(decoder ? [decoder] : []), collector, { signal });
  } catch (error) {
    if (signal.aborted) throw new SourceError('timeout');
    if (error instanceof SourceError) throw error;
    if (failureOrigin === 'decoder') throw new SourceError('invalid-encoded-response');
    throw new SourceError('network-error');
  }
  if (!decodedBytes) throw new SourceError('empty-response');
  return Buffer.concat(chunks, decodedBytes).toString('utf8');
}
