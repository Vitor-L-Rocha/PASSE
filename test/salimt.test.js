// football-datasets (CC0): lesões e temporadas por competição, com arquivos sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seasonOf, buildExtras } from '../scripts/sync-salimt.js';

test('rótulos de temporada', () => {
  assert.deepEqual(seasonOf('24/25'), { label: '2024/25', year: 2024 });
  assert.deepEqual(seasonOf('2025'), { label: '2025', year: 2025 });
  assert.equal(seasonOf('xx'), null);
});

test('extrai temporadas recentes e lesões desde jul/2022 só de jogadores do índice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-salimt-'));
  try {
    const perf = path.join(dir, 'performances.csv');
    const inj = path.join(dir, 'injuries.csv');
    fs.writeFileSync(perf, [
      'player_id,season_name,competition_id,competition_name,team_id,team_name,nb_in_group,nb_on_pitch,goals,assists,own_goals,subed_in,subed_out,yellow_cards,second_yellow_cards,direct_red_cards,penalty_goals,minutes_played,goals_conceded,clean_sheets',
      '10,2025,BRA1,Série A,1,"Clube X, SP",20,18,6.0,3,0,0,0,0,0,0,0,1500.0,0,0',
      '10,2021,BRA1,Série A,1,Clube X,20,18,1.0,1,0,0,0,0,0,0,0,900.0,0,0',
      '10,25/26,CLI,Libertadores,1,Clube X,5,0,0,0,0,0,0,0,0,0,0,,0,0',
      '99,2025,BRA1,Série A,1,Outro,20,18,1.0,1,0,0,0,0,0,0,0,900.0,0,0',
    ].join('\n'));
    fs.writeFileSync(inj, [
      'player_id,season_name,injury_reason,from_date,end_date,days_missed,games_missed',
      '10,25/26,Hamstring injury,2026-09-20,,8.0,2',
      '10,23/24,Knee injury,2023-03-01,2023-04-01,31.0,5',
      '10,21/22,Knock,2021-01-01,2021-01-05,4.0,1',
    ].join('\n'));
    const out = await buildExtras({ performancesFile: perf, injuriesFile: inj, tmIds: new Set(['10']), log: () => {} });
    assert.deepEqual(Object.keys(out), ['tmdata-10']);
    const e = out['tmdata-10'];
    assert.deepEqual(e.seasons.map((s) => [s.season, s.club, s.minutes]), [['2025', 'Clube X, SP', 1500]], 'só 2022+ e com jogos');
    assert.deepEqual(e.injuries.map((i) => i.reason), ['Hamstring injury', 'Knee injury']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provedor: lesões, aviso de lesão em aberto e estatística só como última opção', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-salimt-p-'));
  fs.mkdirSync(path.join(root, 'tm')); fs.mkdirSync(path.join(root, 'sx'));
  fs.writeFileSync(path.join(root, 'tm', 'players.json'), JSON.stringify({ players: [
    { id: 'tmdata-10', source: 'tmdata', name: 'Sem Stats', position: 'ST', leagueId: 'BRA1', leagueCountry: 'BR', marketValueEur: 1, stats: {}, seasons: [] },
    { id: 'tmdata-11', source: 'tmdata', name: 'Com Stats', position: 'ST', leagueId: 'GB1', leagueCountry: 'GB', marketValueEur: 1, minutes: 2000, season: '2025/26',
      stats: { goals: 0.5 }, seasons: [{ season: '2025/26', club: 'Clube Inglês', minutes: 2000 }] },
  ] }));
  const extras = {
    'tmdata-10': { seasons: [{ season: '2025', year: 2025, competitionId: 'BRA1', league: 'Série A', club: 'X', appearances: 18, minutes: 1500, goals: 6, assists: 3 }],
      injuries: [{ reason: 'Hamstring injury', from: '2026-09-20', to: null, daysMissed: 8, gamesMissed: 2 }] },
    'tmdata-11': { seasons: [{ season: '2025/26', year: 2025, competitionId: 'GB1', league: 'Premier League', club: 'Outro nome', appearances: 30, minutes: 2500, goals: 1, assists: 0 },
      { season: '2024/25', year: 2024, competitionId: 'GB1', league: 'Premier League', club: 'Clube Inglês', appearances: 30, minutes: 2400, goals: 10, assists: 2 }], injuries: [] },
  };
  fs.writeFileSync(path.join(root, 'sx', 'extras.json'), JSON.stringify({ players: extras }));
  const prev = { tm: process.env.PASSE_TMDATA_DIR, sx: process.env.PASSE_SALIMT_DIR };
  Object.assign(process.env, { PASSE_TMDATA_DIR: path.join(root, 'tm'), PASSE_SALIMT_DIR: path.join(root, 'sx') });
  try {
    const { createTmdataProvider } = await import('../src/providers/tmdataProvider.js');
    const prov = createTmdataProvider();
    const a = await prov.getPlayer('tmdata-10');
    assert.equal(a.injuredAtSnapshot, true);
    assert.equal(a.minutes, 1500);
    assert.equal(a.stats.goals, 6 * 90 / 1500);
    assert.equal(a.statsNote, 'dados até set/2025');
    const b = await prov.getPlayer('tmdata-11');
    assert.equal(b.stats.goals, 0.5, 'quem já tem estatística não é sobrescrito');
    assert.deepEqual(b.seasons.map((s) => s.season), ['2025/26', '2024/25'], 'temporada repetida não duplica');
    assert.deepEqual(b.injuries, []);
    assert.equal(b.injuredAtSnapshot, false);
  } finally {
    for (const [k, v] of [['PASSE_TMDATA_DIR', prev.tm], ['PASSE_SALIMT_DIR', prev.sx]]) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
