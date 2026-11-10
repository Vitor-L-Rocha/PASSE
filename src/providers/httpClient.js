import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// A URL nunca deve apontar diretamente aos sites protegidos das plataformas.
export function allowedBaseUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (/(^|\.)(transfermarkt\.[a-z.]+|sofascore\.[a-z.]+)$/.test(host)) return null;
    return url.href.replace(/\/?$/, '/');
  } catch { return null; }
}

// Um cliente por configuração: fila por provedor, coalescência, TTL e cache em disco.
// Sem retry automático, proxies ou tratamento especial para proteções anti-bot.
export function createHttpClient({ namespace, baseUrl, headers = {}, ttlMs = 3600000,
  intervalMs = 1500, timeoutMs = 10000, cacheDir = path.resolve('.cache/providers'),
  maxEntries = 500, fetchImpl = globalThis.fetch, now = Date.now, sleep = delay,
  validate = () => {} }) {
  const memory = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  let nextStart = 0;
  let blockedUntil = 0;

  function remember(key, entry) {
    memory.delete(key);
    memory.set(key, entry);
    if (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }

  async function load(key, url) {
    const file = path.join(cacheDir, `${key}.json`);
    let entry = memory.get(key);
    if (!entry) {
      try { entry = JSON.parse(await readFile(file, 'utf8')); } catch { /* miss */ }
    }
    if (entry && Number.isFinite(entry.expires) && entry.expires > now() && 'data' in entry) {
      validate(entry.data);
      remember(key, entry);
      return entry.data;
    }
    memory.delete(key);

    const request = queue.then(async () => {
      if (blockedUntil > now()) throw new Error(`${namespace}: aguarde após bloqueio/rate limit`);
      await sleep(Math.max(0, nextStart - now()));
      nextStart = now() + intervalMs;
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers },
          signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      } catch {
        throw new Error(`${namespace}: falha de rede ou timeout`);
      }
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) {
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const until = retry && !Number.isFinite(seconds) ? Date.parse(retry) : now() + Math.max(60, seconds || 0) * 1000;
          blockedUntil = Math.max(now() + 60000, Number.isFinite(until) ? until : 0);
        }
        throw new Error(`${namespace}: HTTP ${response.status}`);
      }
      let data;
      try { data = await response.json(); } catch { throw new Error(`${namespace}: resposta JSON inválida`); }
      validate(data);
      const fresh = { expires: now() + ttlMs, data };
      remember(key, fresh);
      // Falha de escrita (ex.: disco read-only) não impede uso do cache em memória.
      try {
        await mkdir(cacheDir, { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(fresh), { mode: 0o600 });
        await rename(temp, file);
      } catch { /* cache best effort */ }
      return data;
    });
    queue = request.catch(() => {});
    return request;
  }

  return {
    get(resource, params = {}) {
      const url = new URL(resource, baseUrl);
      for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
      // Inclui credenciais apenas no hash: evita compartilhar cache entre contas.
      const key = createHash('sha256').update(JSON.stringify([namespace, url.href, headers])).digest('hex');
      if (pending.has(key)) return pending.get(key);
      const task = load(key, url).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}
