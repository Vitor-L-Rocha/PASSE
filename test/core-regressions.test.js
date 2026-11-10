import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAttributes } from '../src/core/attributes.js';
import { parseCriteria } from '../src/core/criteria.js';
import { rankPlayers, scorePlayer } from '../src/core/matcher.js';
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

test('pesos, atributos e minutagem inválidos não produzem NaN/fit negativo', () => {
  const result = scorePlayer({ ...player, minutes: -999999, attributes: { defesa: NaN, passe: 100 } },
    { defesa: 3, passe: 1, fisico: -1, velocidade: Infinity });
  assert.equal(result.fit, 85);
  assert.equal(result.strengths.length, 0);
  assert.ok(Number.isFinite(scorePlayer({ ...player, stats: { rating: NaN } }, { _rating: 1 }).fit));
});
