// GOAL API SIMULADA: só jogadores com estatística original, nota e jogos suficientes
// entram; taxas por jogo; prevalece sobre a API-Football antiga e preserva o id de títulos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncGoal, createGoalClient, goalStats, usable } from '../scripts/sync-goalapi.js';

const P = (o) => ({ id: o.id, name: o.name, birthdate: o.dob, statsSource: o.src ?? 'source', matchPlayed: String(o.mp), goals: '4', assists: '2',
  rating: 'rating' in o ? o.rating : '7.10', dribbleSucc: '20', tackles: '10', interceptions: '5', keyPasses: '15', duelsTotal: '100', duelsWon: '55',
  passes: '400', passesAccuracy: '340', team: { name: 'Palmeiras' } });

test('converte estatísticas por jogo e calcula percentuais', () => {
  const s = goalStats(P({ mp: 10 }));
  assert.equal(s.dribbles, 2);
  assert.equal(s.passAccuracy, 85);
  assert.ok(Math.abs(s.duelsWonPct - 55) < 1e-9);
  assert.equal(s.rating, 7.1);
  assert.equal(usable(P({ mp: 7 }), 8), false);
  assert.equal(usable(P({ mp: 10, src: 'derived' }), 8), false);
  assert.equal(usable(P({ mp: 10, rating: null }), 8), false);
  assert.equal(usable(P({ mp: 10 }), 8), true);
});

test('sincroniza, liga ao índice e prevalece sobre dado antigo sem perder o id de títulos', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-goal-'));
  fs.mkdirSync(path.join(root, 'tm'));
  fs.mkdirSync(path.join(root, 'af'));
  fs.writeFileSync(path.join(root, 'tm', 'players.json'), JSON.stringify({
    leagues: [{ id: 'BRA1', name: 'Brasileirão Série A', country: 'BR' }],
    players: [
      { id: 'tmdata-1', source: 'tmdata', name: 'Vitor Roque', dateOfBirth: '2005-02-28', position: 'ST', leagueCountry: 'BR', club: 'SE Palmeiras', marketValueEur: 1, stats: {}, seasons: [] },
      { id: 'tmdata-2', source: 'tmdata', name: 'Pouco Jogo', dateOfBirth: '2001-01-01', position: 'ST', leagueCountry: 'BR', club: 'X', marketValueEur: 1, stats: {}, seasons: [] },
    ],
  }));
  fs.writeFileSync(path.join(root, 'af', 'enrichment.json'), JSON.stringify({ players: { 'tmdata-1': {
    apiId: 77, current: false, season: '2024', team: 'Antigo', minutes: 900, appearances: 10, stats: { goals: 0.1 }, rating: 6.5 } } }));
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const route = u.pathname.split('/').pop();
    const body = route === 'leagues' ? { success: true, data: [{ id: 'L', name: 'Serie A', countryName: 'Brazil', season: '2026' }, { id: 'W', name: 'Serie A Women', countryName: 'Brazil', season: '2026' }] }
      : route === 'teams' ? { success: true, data: [{ id: 'T1', name: 'Palmeiras' }] }
      : { success: true, data: [P({ id: 'g1', name: 'Roque Vitor', dob: '2005-02-28', mp: 19 }), P({ id: 'g2', name: 'Pouco Jogo', dob: '2001-01-01', mp: 3 })], meta: { hasMore: false } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'x-ratelimit-remaining': '990' } });
  };
  const prev = { tm: process.env.PASSE_TMDATA_DIR, af: process.env.PASSE_API_FOOTBALL_DIR, g: process.env.PASSE_GOAL_API_DIR };
  Object.assign(process.env, { PASSE_TMDATA_DIR: path.join(root, 'tm'), PASSE_API_FOOTBALL_DIR: path.join(root, 'af'), PASSE_GOAL_API_DIR: path.join(root, 'goal') });
  try {
    const logs = [];
    const out = await syncGoal({ client: createGoalClient({ key: 'k', baseUrl: 'http://goal.invalid/', fetchImpl }), leagues: ['BRA1'], log: (m) => logs.push(m) });
    assert.deepEqual(Object.keys(out), ['tmdata-1'], 'só quem tem 8+ jogos');
    assert.ok(logs.some((l) => /1 com estatística completa/.test(l) && /1 ligados/.test(l)), logs.join('\n'));
    const { createTmdataProvider } = await import('../src/providers/tmdataProvider.js');
    const p = await createTmdataProvider().getPlayer('tmdata-1');
    assert.equal(p.club, 'Palmeiras', 'clube da temporada atual');
    assert.equal(p.season, '2026');
    assert.equal(p.appearances, 19);
    assert.equal(p.minutes, null);
    assert.equal(p.perGame, true);
    assert.equal(p.recent.source, 'GOAL API');
    assert.equal(p.apiFootballId, 77, 'id da API-Football preservado para os títulos');
    assert.deepEqual(p.seasons.map((x) => x.season), ['2026', '2024']);
  } finally {
    for (const [k, v] of [['PASSE_TMDATA_DIR', prev.tm], ['PASSE_API_FOOTBALL_DIR', prev.af], ['PASSE_GOAL_API_DIR', prev.g]]) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
