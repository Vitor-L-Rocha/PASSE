// Interpreta o texto livre de características ("rápido, canhoto, bom no jogo aéreo")
// e transforma em: pesos por atributo + filtros objetivos (pé, idade, altura).
// Funciona offline, por palavras-chave em PT-BR (com alguns termos em EN/ES).

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cada regra: padrões (regex sobre texto normalizado) -> pesos de atributos.
const TRAIT_RULES = [
  { label: 'Velocidade', re: /\b(rapid[oa]s?|veloz(es)?|velocidade|arranque|explosiv[oa]|speed|fast|profundidade|contra-?ataque)\b/, w: { velocidade: 3 } },
  { label: 'Finalização', re: /\b(finaliza\w*|goleador|artilheiro|matador|faro de gol|gols?|chute|finisher|definidor)\b/, w: { finalizacao: 3 } },
  { label: 'Passe', re: /\b(passe\w*|passador|distribui\w*|lancamento\w*|construcao|saida de bola|passing)\b/, w: { passe: 3 } },
  { label: 'Visão de jogo', re: /\b(visao|criativ[oa]|cerebral|armador|assistencia\w*|cria\w* jogadas?|playmaker|inteligente|garcom)\b/, w: { visao: 3 } },
  { label: 'Drible', re: /\b(dribl\w*|habilidos[oa]|um contra um|1v1|1x1|driblador|tecnic[oa]|ginga|dribbl\w*)\b/, w: { drible: 3 } },
  { label: 'Defesa', re: /\b(marca\w*|desarm\w*|defensiv[oa]|intercept\w*|cobertura|seguro|ladrao de bola|tackl\w*)\b/, w: { defesa: 3 } },
  { label: 'Jogo aéreo', re: /\b(jogo aereo|cabece\w*|bola aerea|aereo|alto|grandao|cabeca)\b/, w: { jogoAereo: 3 } },
  { label: 'Físico', re: /\b(fisico|forte|robusto|corpo|duelos?|imposicao|pivo|brigador|strong)\b/, w: { fisico: 3 } },
  { label: 'Intensidade', re: /\b(intens\w*|incansavel|folego|pressao|pressing|marcacao alta|box to box|motor|vigor|raca|resistencia|dinamic[oa])\b/, w: { intensidade: 3 } },
  { label: 'Goleiro', re: /\b(reflexo\w*|defesas|pegador|elasticidade|goleiro|seguranca no gol)\b/, w: { goleiro: 3 } },
  { label: 'Consistência', re: /\b(regular|consistente|constante|nota alta|decisivo|experiente)\b/, w: { _rating: 2 } },
];

export function parseCriteria(text) {
  const t = normalize(text);
  const weights = {};
  const traits = [];
  const filters = {};

  for (const rule of TRAIT_RULES) {
    if (rule.re.test(t)) {
      traits.push(rule.label);
      for (const [k, v] of Object.entries(rule.w)) weights[k] = (weights[k] || 0) + v;
    }
  }

  // Pé preferencial
  if (/\b(canhot[oa]|pe esquerdo|perna esquerda|left-?footed|zurdo)\b/.test(t)) filters.foot = 'esquerdo';
  else if (/\b(destr[oa]|pe direito|perna direita|right-?footed|diestro)\b/.test(t)) filters.foot = 'direito';
  else if (/\b(ambidestr[oa]|dois pes|ambos os pes)\b/.test(t)) filters.foot = 'ambidestro';

  // Idade
  const sub = t.match(/\bsub ?-?(\d{2})\b/);
  const ateIdade = t.match(/\b(?:ate|maximo|max|no maximo|menos de) (\d{2}) anos\b/);
  const minIdade = t.match(/\b(?:acima de|mais de|minimo|pelo menos) (\d{2}) anos\b/);
  if (sub) filters.maxAge = Number(sub[1]); // sub-23 => até 23 anos
  if (ateIdade) filters.maxAge = Number(ateIdade[1]);
  if (minIdade) filters.minAge = Number(minIdade[1]);
  if (!filters.maxAge && /\b(jovem|jovens|promessa|revelacao|young|garoto)\b/.test(t)) {
    filters.maxAge = 23;
    traits.push('Jovem');
  }
  if (!filters.minAge && /\b(experiente|veterano|rodado|lider)\b/.test(t)) filters.minAge = 27;

  // Altura
  const alt = t.match(/\b(?:acima de|mais de|minimo|pelo menos) (1[ ,.]?\d{2}|\d{3}) ?(?:m|cm)?\b/);
  if (alt) {
    const n = Number(alt[1].replace(/[ ,.]/g, ''));
    filters.minHeightCm = n < 100 ? n * 100 : n;
  }

  return { text: String(text || ''), traits, weights, filters };
}
