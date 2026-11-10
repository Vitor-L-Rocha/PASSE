import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAttributes } from '../src/core/attributes.js';
import { parseCriteria } from '../src/core/criteria.js';
import { rankPlayers, matchPlayer } from '../src/core/matcher.js';
import { characteristicsOf } from '../src/core/characteristics.js';
import { classifyMarket } from '../src/core/markets.js';

test('atributos ignoram null, strings, NaN e infinitos sem contaminar o ranking', () => {
  assert.equal(deriveAttributes(null).passe, 50);
  for (const goals of [NaN, Infinity, -Infinity, '0.8', '', null]) {
    assert.equal(deriveAttributes({ goals }).finalizacao, 50);
  }
  assert.equal(deriveAttributes({ goals: 0 }).finalizacao, 0);
});

test('altura decimal em português/inglês e centímetros gera filtro correto', () => {
  for (const text of ['pelo menos 1,80m', 'mínimo 1.80 m', 'mínimo 180 cm']) {
    assert.equal(parseCriteria(text).filters.minHeightCm, 180, text);
  }
  assert.equal(parseCriteria('mais de 1,80 m').filters.minHeightCm, 181);
  assert.equal(parseCriteria('pelo menos 20 anos').filters.minHeightCm, undefined);
});

test('limites estritos de idade e aviso de pés conflitantes são respeitados', () => {
  assert.equal(parseCriteria('menos de 23 anos').filters.maxAge, 22);
  assert.equal(parseCriteria('mais de 27 anos').filters.minAge, 28);
  assert.equal(parseCriteria('até 23 anos').filters.maxAge, 23);
  const conflicting = parseCriteria('ambidestro, bom com o pé esquerdo');
  assert.equal(conflicting.filters.foot, undefined);
  assert.equal(conflicting.warnings.length, 1);
  assert.equal(parseCriteria('ambidestro').filters.foot, 'ambidestro');
});

const player = { id: 'test-1', position: 'CB', leagueCountry: 'PT', nationality: 'BR',
  age: 22, heightCm: 185, minutes: 900, marketValueEur: 100, stats: {} };

test('filtros objetivos rejeitam campos ausentes e orçamento zero é aplicado', () => {
  for (const [key, text] of [['age', 'até 23 anos'], ['age', 'mínimo 20 anos'], ['heightCm', 'mínimo 180 cm']]) {
    assert.equal(rankPlayers([{ ...player, [key]: null }], { criteria: parseCriteria(text) }).total, 0);
  }
  assert.equal(rankPlayers([player], { maxBudgetEur: 0 }).total, 0);
  assert.equal(rankPlayers([{ ...player, marketValueEur: null }], { maxBudgetEur: 1000 }).total, 0);
  assert.equal(rankPlayers([{ ...player, marketValueEur: 0 }], { maxBudgetEur: 1000 }).total, 1);
});

test('critérios opcionais, posição case insensitive e país da liga', () => {
  const result = rankPlayers([player], { country: 'BR', position: 'cb' });
  assert.equal(result.total, 1);
  assert.equal(result.markets.internacional[0].id, player.id);
  assert.equal(classifyMarket('BR', 'AR'), 'externo');
  assert.equal(classifyMarket('BR', 'BR'), 'interno');
  assert.equal(rankPlayers([player]).total, 1);
});

test('características: fonte tem prioridade, códigos desconhecidos são descartados e stats inválidas não geram pontos', () => {
  const fromSource = characteristicsOf({ ...player, characteristics: { positive: ['desarme', 'xyz'], negative: ['passe'] } });
  assert.deepEqual(fromSource, { positive: ['desarme'], negative: ['passe'], source: 'fonte' });
  const derived = characteristicsOf({ ...player, stats: { tackles: NaN, interceptions: Infinity, rating: 'x' } });
  assert.equal(derived.source, 'indisponivel', 'sem stats utilizáveis não há características');
  assert.deepEqual(derived.positive, []);
  const m = matchPlayer({ ...player, characteristics: { positive: ['desarme', 'cabeceio'], negative: ['passe'] } }, ['cabeceio', 'passe', 'velocidade']);
  assert.deepEqual(m.matched, ['cabeceio']);
  assert.deepEqual(m.weakIn, ['passe']);
});

test('ranking por características: exige ao menos uma pedida e ordena por quantidade atendida', () => {
  const a = { ...player, id: 'a', characteristics: { positive: ['desarme'], negative: [] } };
  const b = { ...player, id: 'b', characteristics: { positive: ['desarme', 'cabeceio'], negative: [] } };
  const c = { ...player, id: 'c', characteristics: { positive: ['passe'], negative: [] } };
  const r = rankPlayers([a, b, c], { country: 'PT', criteria: { characteristics: ['desarme', 'cabeceio'] } });
  assert.deepEqual(r.markets.interno.map((p) => p.id), ['b', 'a']);
  assert.equal(r.usingPositionProfile, false);
});

test('jogadores sem dados de desempenho entram no fim; características indisponíveis na fonte são ignoradas', () => {
  const withData = { ...player, id: 'com', minutes: 2000, characteristics: { positive: ['desarme'], negative: [] } };
  const noData = { ...player, id: 'sem', minutes: null, stats: {} };
  const other = { ...player, id: 'outro', characteristics: { positive: ['passe'], negative: [] } };
  const r = rankPlayers([noData, other, withData], { country: 'PT', criteria: { characteristics: ['desarme', 'drible'] }, available: ['desarme', 'passe'] });
  assert.deepEqual(r.markets.interno.map((p) => p.id), ['com', 'sem']);
  assert.equal(r.markets.interno[1].match.noData, true);
  assert.deepEqual(r.desired, ['desarme']);
  assert.deepEqual(r.ignored, ['drible']);
});

test('pedido só com características inavaliáveis vira busca neutra, sem trocar pelo perfil da posição', () => {
  const a = { ...player, id: 'a', minutes: 500, characteristics: { positive: ['desarme'], negative: [] } };
  const b = { ...player, id: 'b', minutes: 2500, characteristics: { positive: ['passe'], negative: [] } };
  const r = rankPlayers([a, b], { country: 'PT', position: 'CB', criteria: { characteristics: ['drible'] }, available: ['desarme'] });
  assert.equal(r.usingPositionProfile, false);
  assert.deepEqual(r.desired, []);
  assert.deepEqual(r.ignored, ['drible']);
  assert.deepEqual(r.markets.interno.map((p) => p.id), ['b', 'a'], 'neutra: mais minutos primeiro');
});
