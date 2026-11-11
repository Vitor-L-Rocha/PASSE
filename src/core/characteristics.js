// Características (pontos fortes / fracos) de um jogador.
//
// Preferência: as características informadas pela FONTE (ex.: SofaScore).
// Quando a fonte não fornece, derivamos das estatísticas por 90 minutos, comparando
// com faixas de referência. Os valores numéricos são internos: o PASSE só expõe
// a lista de características, nunca uma nota de competência.

import { getCharacteristic } from '../data/characteristics.js';
import { getPosition } from '../data/positions.js';
import { deriveAttributes } from './attributes.js';

const STRONG = 66;
const WEAK = 28;
const MAX_POSITIVE = 6;
const MAX_NEGATIVE = 3;

const has = (v) => typeof v === 'number' && Number.isFinite(v);
function scale(v, lo, hi) {
  if (!has(v)) return null;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

// Características que, se fracas, importam para cada posição (geram "ponto fraco").
const CORE_BY_POSITION = {
  GK: ['reflexos', 'saidasDoGol', 'jogoComOsPes'],
  CB: ['desarme', 'interceptacao', 'duelosAereos', 'passe'],
  LB: ['velocidade', 'desarme', 'cruzamentos', 'intensidade'],
  RB: ['velocidade', 'desarme', 'cruzamentos', 'intensidade'],
  DM: ['desarme', 'interceptacao', 'passe', 'intensidade'],
  CM: ['passe', 'intensidade', 'criacao'],
  AM: ['criacao', 'passesDecisivos', 'drible', 'finalizacao'],
  LW: ['velocidade', 'drible', 'finalizacao'],
  RW: ['velocidade', 'drible', 'finalizacao'],
  ST: ['finalizacao', 'cabeceio', 'duelosNoChao'],
};

// Faixas de referência por grupo de posição (valor por 90 min: [baixo, alto]).
// Um meia com 1,5 passe decisivo/90 se destaca; um zagueiro com 1,5 desarme/90 não.
const RANGES = {
  ATT: { goals: [0.12, 0.55], xg: [0.12, 0.5], keyPasses: [0.6, 2.2], assists: [0.05, 0.3], dribbles: [0.7, 2.6], tackles: [0.2, 1.4], interceptions: [0.1, 0.8], crosses: [0.2, 1.4] },
  MID: { goals: [0.03, 0.3], xg: [0.03, 0.28], keyPasses: [0.5, 2.0], assists: [0.03, 0.25], dribbles: [0.3, 1.8], tackles: [0.7, 2.6], interceptions: [0.4, 1.7], crosses: [0.1, 1.0] },
  DEF: { goals: [0.02, 0.15], xg: [0.02, 0.12], keyPasses: [0.15, 1.2], assists: [0.02, 0.15], dribbles: [0.1, 1.2], tackles: [0.9, 2.9], interceptions: [0.6, 2.1], crosses: [0.2, 1.4] },
};

function blend(...vals) {
  const v = vals.filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function scores(player) {
  const s = player.stats || {};
  const a = deriveAttributes(s, player);
  const group = getPosition(player.position)?.group;
  const avail = (stat, value) => (has(stat) ? value : null);
  if (group === 'GK') {
    return {
      reflexos: scale(s.savePct, 62, 80),
      saidasDoGol: scale(s.aerialsWon, 0.3, 2),
      jogoComOsPes: scale(s.passAccuracy, 62, 88),
      consistencia: scale(s.rating, 6.6, 7.6),
    };
  }
  const R = RANGES[group] || RANGES.MID;
  const r = (key, stat) => scale(s[stat ?? key], ...R[key]);
  return {
    finalizacao: blend(r('goals'), r('xg')),
    cabeceio: player.position === 'ST' || group === 'DEF' ? avail(s.aerialsWon, a.jogoAereo) : null,
    duelosAereos: avail(s.aerialsWon, a.jogoAereo),
    drible: r('dribbles'),
    controleDeBola: has(s.dribbles) && has(s.passAccuracy) ? (r('dribbles') + scale(s.passAccuracy, 72, 90)) / 2 : null,
    velocidade: avail(s.topSpeedKmh, a.velocidade),
    passe: scale(s.passAccuracy, 74, 91),
    passesDecisivos: r('keyPasses'),
    criacao: blend(r('keyPasses'), r('assists')),
    cruzamentos: r('crosses', 'accurateCrosses'),
    desarme: r('tackles'),
    interceptacao: r('interceptions'),
    duelosNoChao: avail(s.duelsWonPct, a.fisico),
    intensidade: has(s.distanceKm) || has(s.recoveries) ? a.intensidade : null,
    consistencia: scale(s.rating, 6.6, 7.6),
  };
}

export function deriveCharacteristics(player) {
  const sc = scores(player);
  const group = getPosition(player.position)?.group;
  const core = CORE_BY_POSITION[player.position] || [];
  const entries = Object.entries(sc).filter(
    ([code, v]) => v !== null && (!group || getCharacteristic(code)?.positions.includes(group))
  );
  // Sem nenhuma estatística utilizável: não dá para afirmar pontos fortes nem fracos.
  if (entries.length === 0) return { positive: [], negative: [], evaluable: [], source: 'indisponivel' };
  // Características que as estatísticas DESTE jogador permitem avaliar.
  const evaluable = entries.map(([c]) => c);
  const positive = entries
    .filter(([, v]) => v >= STRONG)
    .sort((x, y) => y[1] - x[1])
    .slice(0, MAX_POSITIVE)
    .map(([c]) => c);
  const negative = entries
    .filter(([c, v]) => v <= WEAK && core.includes(c))
    .sort((x, y) => x[1] - y[1])
    .slice(0, MAX_NEGATIVE)
    .map(([c]) => c);
  return { positive, negative, evaluable, source: 'estatisticas' };
}

// Usa o que a fonte informou; se não houver, deriva das estatísticas.
export function characteristicsOf(player) {
  const c = player.characteristics;
  if (c && (c.positive?.length || c.negative?.length)) {
    return {
      positive: (c.positive || []).filter(getCharacteristic),
      negative: (c.negative || []).filter(getCharacteristic),
      source: c.source || 'fonte',
      evaluable: null, // fonte própria: todas as características do vocabulário
    };
  }
  return deriveCharacteristics(player);
}

export { CORE_BY_POSITION };
