// Converte estatísticas brutas (por 90 minutos / percentuais) em atributos 0–100.
// Qualquer provedor (demo, Transfermarkt, SofaScore...) deve entregar `stats`
// neste formato; os atributos são sempre derivados aqui, garantindo comparabilidade.
//
// Formato esperado de `stats` (campos ausentes são ignorados):
//   per90: goals, xg, shots, assists, keyPasses, dribbles, tackles,
//          interceptions, recoveries, aerialsWon, saves
//   pct:   passAccuracy, duelsWonPct, aerialWonPct, savePct
//   outros: topSpeedKmh, distanceKm, rating

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function scale(value, lo, hi) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return clamp(((value - lo) / (hi - lo)) * 100);
}

// Média ponderada ignorando componentes indisponíveis.
function blend(parts) {
  let sum = 0;
  let w = 0;
  for (const [v, weight] of parts) {
    if (v === null) continue;
    sum += v * weight;
    w += weight;
  }
  return w === 0 ? null : Math.round(sum / w);
}

export function deriveAttributes(stats = {}, { heightCm, position } = {}) {
  const s = stats;
  const attrs = {
    finalizacao: blend([
      [scale(s.goals, 0, 0.8), 2],
      [scale(s.xg, 0, 0.7), 1.5],
      [scale(s.shots, 0, 4), 0.5],
    ]),
    passe: blend([
      [scale(s.passAccuracy, 68, 93), 2],
      [scale(s.keyPasses, 0, 3), 1],
    ]),
    visao: blend([
      [scale(s.keyPasses, 0, 3), 2],
      [scale(s.assists, 0, 0.45), 1.5],
    ]),
    drible: blend([[scale(s.dribbles, 0, 3.5), 1]]),
    defesa: blend([
      [scale(s.tackles, 0, 3.5), 1.5],
      [scale(s.interceptions, 0, 2.5), 1.5],
      [scale(s.recoveries, 2, 9), 1],
    ]),
    jogoAereo: blend([
      [scale(s.aerialsWon, 0, 5), 1.5],
      [scale(s.aerialWonPct, 30, 75), 1],
      [scale(heightCm, 168, 198), 0.7],
    ]),
    fisico: blend([
      [scale(s.duelsWonPct, 35, 65), 2],
      [scale(heightCm, 165, 195), 0.5],
    ]),
    intensidade: blend([
      [scale(s.distanceKm, 8.5, 12.5), 1.5],
      [scale(s.recoveries, 2, 9), 1],
      [scale(s.tackles, 0, 3.5), 0.5],
    ]),
    velocidade: blend([[scale(s.topSpeedKmh, 29, 36), 1]]),
    goleiro:
      position === 'GK'
        ? blend([
            [scale(s.savePct, 58, 82), 2],
            [scale(s.saves, 1, 4.5), 1],
          ])
        : 0,
  };
  for (const k of Object.keys(attrs)) if (attrs[k] === null) attrs[k] = 50; // neutro quando não há dado
  return attrs;
}
