// Dataset de DEMONSTRAÇÃO: jogadores e clubes FICTÍCIOS, gerados de forma
// determinística. Serve para desenvolvimento, testes e uso offline enquanto
// provedores reais (Transfermarkt/SofaScore) não estão configurados.
// Nenhum nome, valor ou estatística aqui corresponde a uma pessoa real.

import { COUNTRIES } from './countries.js';
import { POSITIONS } from './positions.js';

function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  latin: {
    first: ['Rafael', 'Thiago', 'Mateus', 'Lucas', 'Diego', 'Bruno', 'Caio', 'Joaquín', 'Santiago', 'Matías', 'Nicolás', 'Felipe', 'Gustavo', 'Enzo', 'Tomás', 'Iago', 'Davi', 'Emiliano', 'Facundo', 'Renan'],
    last: ['Valença', 'Moreira', 'Tavares', 'Quintero', 'Sarmiento', 'Albuquerque', 'Brandão', 'Cardoso', 'Duarte', 'Esteves', 'Figueroa', 'Galeano', 'Ibarra', 'Lacerda', 'Medina', 'Navarro', 'Ocampo', 'Paredes', 'Rezende', 'Siqueira'],
  },
  euro: {
    first: ['Luca', 'Jonas', 'Mats', 'Pierre', 'Hugo', 'Marco', 'Lars', 'Nikola', 'Ivan', 'Theo', 'Elias', 'Milan', 'Oskar', 'Adrien', 'Kai', 'Filip', 'Dario', 'Jan', 'Leon', 'Arne'],
    last: ['Varenne', 'Kessler', 'Lindqvist', 'Moretti', 'Novak', 'Brandt', 'Castellan', 'Dufresne', 'Eriksen-Holm', 'Falconi', 'Gruber', 'Hartmann', 'Ivković', 'Janssen', 'Kovač', 'Lemaire', 'Marchetti', 'Nyberg', 'Olsen', 'Petrović'],
  },
  africa: {
    first: ['Youssef', 'Kwame', 'Amadou', 'Karim', 'Tunde', 'Sipho', 'Omar', 'Ibrahim', 'Moussa', 'Chidi'],
    last: ['Benali', 'Mensah', 'Diallo', 'Haddad', 'Okafor', 'Ndlovu', 'Traoré', 'El Amrani', 'Adeyemi', 'Kamara'],
  },
  asia: {
    first: ['Haruto', 'Min-jun', 'Faisal', 'Kenta', 'Ji-ho', 'Salem', 'Wei', 'Riku', 'Hamad', 'Sota'],
    last: ['Takeda', 'Park', 'Al-Harbi', 'Morimoto', 'Seo', 'Al-Mansouri', 'Zhang', 'Kobayashi', 'Al-Kaabi', 'Yoon'],
  },
  anglo: {
    first: ['Jack', 'Ethan', 'Mason', 'Liam', 'Owen', 'Callum', 'Riley', 'Noah', 'Tyler', 'Jordan'],
    last: ['Ashford', 'Bramwell', 'Calloway', 'Dunmore', 'Ellison', 'Fairbank', 'Garrick', 'Hollins', 'Kingsley', 'Whitlock'],
  },
};

const NAME_POOL_BY_CONTINENT = { SA: 'latin', NA: 'anglo', EU: 'euro', AF: 'africa', AS: 'asia', OC: 'anglo' };

// Fator de "força financeira" da liga (afeta valor de mercado).
const LEAGUE_FACTOR = {
  GB: 3.2, ES: 2.4, DE: 2.2, IT: 2.2, FR: 1.9, PT: 1.3, NL: 1.2, BR: 1.1, BE: 0.9, TR: 0.8, SA: 0.9,
  AR: 0.7, US: 0.8, MX: 0.7, AT: 0.6, CH: 0.6, DK: 0.55, GR: 0.55, UA: 0.45, RS: 0.4, HR: 0.45,
  CO: 0.4, UY: 0.35, CL: 0.35, EC: 0.35, PY: 0.3, JP: 0.45, KR: 0.4, QA: 0.5, AE: 0.5, CN: 0.4,
  EG: 0.25, MA: 0.3, ZA: 0.25, NG: 0.15, AU: 0.3, CA: 0.35, CR: 0.15, PE: 0.25, VE: 0.15, BO: 0.12,
};

const CLUB_PREFIX = ['Atlético', 'Sporting', 'Real', 'União', 'Racing', 'Deportivo', 'Athletic', 'Olímpico', 'Estrela', 'Inter'];
const SYLL = ['var', 'do', 'na', 'lu', 'ce', 'ri', 'mon', 'ta', 'bel', 'so', 'ra', 'quim', 'len', 'por', 'vi', 'sa'];

const FEET = ['direito', 'direito', 'direito', 'esquerdo', 'esquerdo', 'ambidestro'];

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function gauss(rand) {
  // Box-Muller
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const r2 = (n) => Math.round(n * 100) / 100;

function cityName(rand) {
  const n = 2 + Math.floor(rand() * 2);
  let s = '';
  for (let i = 0; i < n; i++) s += pick(rand, SYLL);
  return s[0].toUpperCase() + s.slice(1);
}

// Gera estatísticas coerentes com a posição e um "talento" latente.
function makeStats(rand, pos, q, heightCm) {
  const g = () => gauss(rand) * 0.15;
  const k = (base, spread) => Math.max(0, base + spread * (q - 0.5) * 2 + base * g());
  const group = pos.group;
  const att = group === 'ATT' ? 1 : pos.code === 'AM' ? 0.7 : group === 'MID' ? 0.35 : 0.12;
  const def = group === 'DEF' ? 1 : pos.code === 'DM' ? 0.95 : group === 'MID' ? 0.6 : 0.2;
  const wide = ['LW', 'RW', 'LB', 'RB'].includes(pos.code);
  const isGK = pos.code === 'GK';

  const stats = {
    goals: isGK ? 0 : r2(k(0.35 * att, 0.3 * att) * (pos.code === 'ST' ? 1.4 : 1)),
    xg: isGK ? 0 : r2(k(0.3 * att, 0.25 * att) * (pos.code === 'ST' ? 1.4 : 1)),
    shots: isGK ? 0 : r2(k(2.2 * att, 1.4 * att)),
    assists: isGK ? 0 : r2(k(0.15 * (att + 0.3), 0.15)),
    keyPasses: isGK ? 0 : r2(k(1.1 * (att + 0.4), 0.9)),
    dribbles: isGK ? 0 : r2(k((wide ? 1.6 : 0.8) * (att + 0.3), 1.0)),
    tackles: isGK ? 0 : r2(k(2.0 * def, 1.0 * def)),
    interceptions: isGK ? 0 : r2(k(1.3 * def, 0.8 * def)),
    recoveries: isGK ? r2(k(3, 1)) : r2(k(4 + 3 * def, 2)),
    aerialsWon: r2(k((pos.code === 'CB' || pos.code === 'ST' ? 3 : 1) * ((heightCm - 160) / 25), 1.2)),
    aerialWonPct: r2(Math.min(85, 40 + (heightCm - 170) * 0.9 + q * 15 + g() * 30)),
    passAccuracy: r2(Math.min(95, 74 + q * 14 + (pos.group === 'MID' ? 3 : 0) + g() * 20)),
    duelsWonPct: r2(Math.min(75, 42 + q * 16 + (heightCm - 178) * 0.25 + g() * 25)),
    distanceKm: r2(9.3 + (isGK ? -3.5 : 0) + (pos.group === 'MID' ? 1.4 : 0.6) + q * 1.2 + g() * 4),
    topSpeedKmh: r2(30.5 + (wide || pos.code === 'ST' ? 2.2 : 0) - (isGK ? 2 : 0) - (heightCm - 180) * 0.05 + q * 2.3 + g() * 8),
    saves: isGK ? r2(k(2.6, 1.2)) : 0,
    savePct: isGK ? r2(Math.min(88, 64 + q * 16 + g() * 25)) : 0,
  };
  stats.rating = r2(Math.min(8.6, 6.3 + q * 1.4 + g() * 2));
  return stats;
}

let cache = null;

export function generateDemoPlayers({ perCountry = 60, seed = 20261110 } = {}) {
  if (cache && cache.seed === seed && cache.perCountry === perCountry) return cache.players;
  const rand = mulberry32(seed);
  const players = [];
  let id = 1;
  for (const country of COUNTRIES) {
    const pool = NAMES[NAME_POOL_BY_CONTINENT[country.continent]];
    const clubs = Array.from({ length: 8 }, () => `${pick(rand, CLUB_PREFIX)} ${cityName(rand)}`);
    const factor = LEAGUE_FACTOR[country.code] ?? 0.3;
    for (let i = 0; i < perCountry; i++) {
      const pos = POSITIONS[i % POSITIONS.length];
      const age = 17 + Math.floor(rand() * 18);
      const q = Math.min(1, Math.max(0, 0.5 + gauss(rand) * 0.2));
      const heightBase = pos.code === 'GK' || pos.code === 'CB' ? 189 : pos.code === 'ST' ? 184 : 177;
      const heightCm = Math.round(heightBase + gauss(rand) * 5);
      // Jogadores jovens às vezes são de outra nacionalidade (mercado é pelo país da liga).
      const foreign = rand() < 0.2 ? pick(rand, COUNTRIES) : country;
      const ageFactor = age < 21 ? 1.3 : age < 26 ? 1.15 : age < 30 ? 1 : age < 33 ? 0.6 : 0.3;
      const marketValueEur = Math.max(
        50_000,
        Math.round((Math.exp(q * 4.2) * 180_000 * factor * ageFactor) / 50_000) * 50_000
      );
      const matches = 8 + Math.floor(rand() * 30);
      const foot = pos.code === 'LB' || pos.code === 'LW' ? (rand() < 0.7 ? 'esquerdo' : pick(rand, FEET)) : pick(rand, FEET);
      players.push({
        id: `demo-${id++}`,
        source: 'demo',
        name: `${pick(rand, pool.first)} ${pick(rand, pool.last)}`,
        age,
        nationality: foreign.code,
        foot,
        heightCm,
        position: pos.code,
        club: pick(rand, clubs),
        league: `Liga ${country.name} (demo)`,
        leagueCountry: country.code,
        marketValueEur,
        contractUntil: `${2027 + Math.floor(rand() * 4)}-06-30`,
        season: '2026',
        appearances: matches,
        minutes: matches * (60 + Math.floor(rand() * 30)),
        stats: makeStats(rand, pos, q, heightCm),
        links: {},
      });
    }
  }
  cache = { seed, perCountry, players };
  return players;
}
