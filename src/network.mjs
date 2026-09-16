import https from 'node:https';
import { lookup } from 'node:dns/promises';
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
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); reject(new SourceError('unexpected-encoding')); return; }
        if (!/\b(json|html|xml|plain)\b/i.test(res.headers['content-type'] || '')) { res.destroy(); reject(new SourceError('invalid-content-type')); return; }
        if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); reject(new SourceError('response-too-large')); return; }
        const chunks = []; let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { res.destroy(); reject(new SourceError('response-too-large')); } else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => { if (!bytes) reject(new SourceError('empty-response')); else resolve(Buffer.concat(chunks).toString('utf8')); });
      });
      req.on('error', reject);
    });
  }
}
