// Cliente mínimo da API-Football (API-Sports v3, acesso oficial por chave).
// Usado pela sincronização (scripts/sync-apifootball.js) e pelos títulos na ficha.
//
// Limites do plano grátis: 100 consultas/dia e um limite POR MINUTO. As consultas são
// espaçadas (PASSE_API_FOOTBALL_INTERVAL_MS, padrão 6,5 s) e, se o limite por minuto
// for atingido mesmo assim, o cliente espera e tenta de novo uma única vez.

export class ApiError extends Error {}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiErrorMessage(json) {
  const e = json?.errors;
  if (!e) return null;
  if (Array.isArray(e)) return e.length ? e.map(String).join(' ') : null;
  if (typeof e === 'object') return Object.keys(e).length ? Object.values(e).map(String).join(' ') : null;
  return String(e);
}

const isMinuteLimit = (msg) => /rate ?limit|per minute|too many requests/i.test(msg || '');

export function createClient({
  key = process.env.PASSE_API_FOOTBALL_KEY,
  baseUrl = process.env.PASSE_API_FOOTBALL_URL || 'https://v3.football.api-sports.io/',
  fetchImpl = fetch,
  intervalMs = Number(process.env.PASSE_API_FOOTBALL_INTERVAL_MS ?? 6500),
  retryWaitMs = 61000,
  sleep = delay,
} = {}) {
  if (!key) throw new ApiError('Chave da API-Football ausente. Coloque PASSE_API_FOOTBALL_KEY=... no arquivo .env.');
  let calls = 0;
  let last = 0;

  async function request(url) {
    const wait = last + intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return fetchImpl(url, { headers: { 'x-apisports-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  }

  return {
    get calls() { return calls; },
    async get(route, params = {}) {
      const url = new URL(route.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      for (let attempt = 0; ; attempt++) {
        const res = await request(url);
        if (route !== 'status') calls++;
        if (res.status === 401 || res.status === 403) throw new ApiError('Chave recusada pela API-Football (verifique PASSE_API_FOOTBALL_KEY).');
        const dailyHeader = res.headers?.get?.('x-ratelimit-requests-remaining');
        const dailyLeft = dailyHeader == null || dailyHeader === '' ? NaN : Number(dailyHeader);
        let json = null;
        let msg = null;
        if (res.status === 429) msg = 'Too many requests';
        else if (!res.ok) throw new ApiError(`API-Football respondeu HTTP ${res.status}.`);
        else {
          json = await res.json();
          msg = apiErrorMessage(json);
        }
        if (!msg) return json;
        const daily = /request limit for the day|daily/i.test(msg) || (Number.isFinite(dailyLeft) && dailyLeft <= 0);
        if (daily) throw new ApiError('Cota diária da API-Football esgotada. Rode de novo amanhã (renova 00:00 UTC); a sincronização continua de onde parou.');
        if ((res.status === 429 || isMinuteLimit(msg)) && attempt === 0) {
          await sleep(retryWaitMs); // limite por minuto: espera a janela virar e tenta uma vez
          continue;
        }
        if (res.status === 429 || isMinuteLimit(msg)) throw new ApiError('Limite por minuto da API-Football atingido mesmo após esperar. Tente aumentar PASSE_API_FOOTBALL_INTERVAL_MS.');
        throw new ApiError(msg);
      }
    },
  };
}
