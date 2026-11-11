// Cliente mínimo da API-Football (API-Sports v3, acesso oficial por chave).
// Usado pela sincronização (scripts/sync-apifootball.js) e pelos títulos na ficha.

export class ApiError extends Error {}

function apiErrorMessage(json) {
  const e = json?.errors;
  if (!e) return null;
  if (Array.isArray(e)) return e.length ? e.map(String).join(' ') : null;
  if (typeof e === 'object') return Object.keys(e).length ? Object.values(e).map(String).join(' ') : null;
  return String(e);
}

export function createClient({ key = process.env.PASSE_API_FOOTBALL_KEY, baseUrl = process.env.PASSE_API_FOOTBALL_URL || 'https://v3.football.api-sports.io/', fetchImpl = fetch } = {}) {
  if (!key) throw new ApiError('Chave da API-Football ausente. Coloque PASSE_API_FOOTBALL_KEY=... no arquivo .env.');
  let calls = 0;
  return {
    get calls() { return calls; },
    async get(route, params = {}) {
      const url = new URL(route.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      const res = await fetchImpl(url, { headers: { 'x-apisports-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (route !== 'status') calls++;
      if (res.status === 401 || res.status === 403) throw new ApiError('Chave recusada pela API-Football (verifique PASSE_API_FOOTBALL_KEY).');
      if (res.status === 429) throw new ApiError('Limite de consultas da API-Football atingido. Tente de novo amanhã (a cota renova 00:00 UTC).');
      if (!res.ok) throw new ApiError(`API-Football respondeu HTTP ${res.status}.`);
      const json = await res.json();
      const msg = apiErrorMessage(json);
      if (msg) throw new ApiError(msg);
      return json;
    },
  };
}
