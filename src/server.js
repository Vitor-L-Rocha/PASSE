import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRIES, CONTINENTS, getCountry } from './data/countries.js';
import { POSITIONS, getPosition } from './data/positions.js';
import { CHARACTERISTICS } from './data/characteristics.js';
import { MARKETS } from './core/markets.js';
import { parseCriteria } from './core/criteria.js';
import { rankPlayers } from './core/matcher.js';
import { characteristicsOf } from './core/characteristics.js';
import { searchAll, getPlayerById } from './providers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_RESULTS_PER_MARKET = 25;

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/meta', (_req, res) => {
    res.json({
      countries: COUNTRIES,
      continents: CONTINENTS,
      positions: POSITIONS.map(({ code, name, group }) => ({ code, name, group })),
      characteristics: CHARACTERISTICS.map(({ code, label, positions }) => ({ code, label, positions })),
      markets: MARKETS,
    });
  });

  app.post('/api/search', async (req, res) => {
    // `characteristics`: texto livre; `selectedCharacteristics`: códigos escolhidos na interface.
    const { country, maxBudgetEur, position, characteristics = '', selectedCharacteristics = [] } = req.body || {};
    const errors = [];
    if (!getCountry(country)) errors.push('País inválido.');
    if (!getPosition(position)) errors.push('Posição inválida.');
    const budget = Number(maxBudgetEur);
    if (!Number.isFinite(budget) || budget <= 0) errors.push('Teto orçamentário deve ser um número positivo (em euros).');
    if (typeof characteristics !== 'string' || characteristics.length > 1000) errors.push('Características: texto de até 1000 caracteres.');
    if (!Array.isArray(selectedCharacteristics) || selectedCharacteristics.length > 30 || !selectedCharacteristics.every((c) => typeof c === 'string' && c.length <= 40)) {
      errors.push('Características selecionadas: lista de até 30 códigos.');
    }
    if (errors.length) return res.status(400).json({ errors });

    try {
      const criteria = parseCriteria(characteristics, selectedCharacteristics);
      const { players, errors: providerErrors, providers } = await searchAll({ position, maxBudgetEur: budget });
      const ranking = rankPlayers(players, { country, maxBudgetEur: budget, position, criteria });
      for (const k of Object.keys(ranking.markets)) {
        ranking.markets[k] = ranking.markets[k].slice(0, MAX_RESULTS_PER_MARKET).map(summary);
      }
      res.json({ query: { country, maxBudgetEur: budget, position }, criteria, providers, providerErrors, ...ranking });
    } catch (err) {
      console.error(err);
      res.status(500).json({ errors: ['Falha ao consultar os provedores de dados.'] });
    }
  });

  app.get('/api/players/:id', async (req, res) => {
    try {
      const player = await getPlayerById(req.params.id);
      if (!player) return res.status(404).json({ errors: ['Jogador não encontrado.'] });
      res.json({ ...player, characteristics: characteristicsOf(player) });
    } catch (err) {
      console.error(err);
      res.status(502).json({ errors: ['Falha ao carregar o jogador.'] });
    }
  });

  return app;
}

// Versão compacta para a listagem; o dashboard busca o detalhe completo.
function summary(p) {
  const { id, source, name, age, nationality, foot, position, club, league, leagueCountry, marketValueEur, photoUrl, market, match, characteristics } = p;
  return { id, source, name, age, nationality, foot, position, club, league, leagueCountry, marketValueEur, photoUrl: photoUrl ?? null, market, match, characteristics };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`PASSE rodando em http://localhost:${port}`));
}
