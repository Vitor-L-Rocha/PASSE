// Interpreta o que o clube procura: características selecionadas (códigos de
// src/data/characteristics.js) + texto livre ("rápido, canhoto, bom no jogo aéreo").
// Resultado: lista de características desejadas + filtros objetivos (pé, idade, altura).
// Funciona offline, por palavras-chave em PT-BR.

import { CHARACTERISTICS, getCharacteristic } from '../data/characteristics.js';

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RULES = CHARACTERISTICS.map((c) => ({
  code: c.code,
  re: new RegExp(`\\b(?:${c.keywords.map(escapeRe).join('|')})(?:s|es)?\\b`),
}));

export function parseCriteria(text, selected = []) {
  const t = normalize(text);
  const characteristics = [];
  const add = (code) => {
    if (getCharacteristic(code) && !characteristics.includes(code)) characteristics.push(code);
  };
  for (const code of Array.isArray(selected) ? selected : []) add(code);
  for (const rule of KEYWORD_RULES) if (rule.re.test(t)) add(rule.code);
  const traits = characteristics.map((c) => getCharacteristic(c).label);
  const filters = {};

  // Pé preferencial. Se o texto pedir pés diferentes (ex.: "canhoto destro"),
  // não filtra por pé e devolve um aviso, em vez de escolher um silenciosamente.
  const warnings = [];
  const feet = [
    [/\b(ambidestr[oa]|dois pes|ambos os pes)\b/, 'ambidestro'],
    [/\b(canhot[oa]|pe esquerdo|perna esquerda|left-?footed|zurdo)\b/, 'esquerdo'],
    [/\b(destr[oa]|pe direito|perna direita|right-?footed|diestro)\b/, 'direito'],
  ].filter(([re]) => re.test(t)).map(([, foot]) => foot);
  if (feet.length === 1) filters.foot = feet[0];
  else if (feet.length > 1) warnings.push(`Pés conflitantes no texto (${feet.join(', ')}); o filtro de pé foi ignorado.`);

  // Idade
  const sub = t.match(/\bsub ?-?(\d{2})\b/);
  const ateIdade = t.match(/\b(?:ate|maximo|max|no maximo|menos de) (\d{2}) anos\b/);
  const minIdade = t.match(/\b(?:acima de|mais de|minimo|pelo menos) (\d{2}) anos\b/);
  if (sub) filters.maxAge = Number(sub[1]); // sub-23 => até 23 anos
  if (ateIdade) filters.maxAge = Number(ateIdade[1]) - (ateIdade[0].startsWith('menos de') ? 1 : 0);
  if (minIdade) filters.minAge = Number(minIdade[1]) + (/^(acima de|mais de)/.test(minIdade[0]) ? 1 : 0);
  if (!filters.maxAge && /\b(jovem|jovens|promessa|revelacao|young|garoto)\b/.test(t)) {
    filters.maxAge = 23;
    traits.push('Jovem');
  }
  if (!filters.minAge && /\b(experiente|veterano|rodado|lider)\b/.test(t)) filters.minAge = 27;

  // Altura
  const alt = t.match(/\b(?:acima de|mais de|minimo|pelo menos) (1 ?\d{2}|\d{3}) ?(?:m|cm)?\b/);
  if (alt) {
    const n = Number(alt[1].replace(/[ ,.]/g, ''));
    filters.minHeightCm = n + (/^(acima de|mais de)/.test(alt[0]) ? 1 : 0);
  }

  return { text: String(text || ''), characteristics, traits, filters, warnings };
}
