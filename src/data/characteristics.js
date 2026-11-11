// Vocabulário de CARACTERÍSTICAS do PASSE.
// O PASSE não dá notas de competência aos jogadores: ele descreve cada atleta por
// pontos fortes e pontos fracos (no estilo do SofaScore) e cruza isso com o que o
// clube procura. Provedores devem mapear as características da fonte para estes códigos.
//
// `keywords`: termos (sem acento, minúsculos) que o usuário pode escrever no texto livre.
// `positions`: grupos em que a característica faz sentido (GK, DEF, MID, ATT).

export const CHARACTERISTICS = [
  { code: 'finalizacao', label: 'Finalização', positions: ['MID', 'ATT'], keywords: ['finaliza', 'finalizador', 'artilheiro', 'goleador', 'matador', 'faro de gol', 'definidor', 'gols', 'gol'] },
  { code: 'chutesDeLonge', label: 'Chutes de longe', positions: ['MID', 'ATT'], keywords: ['chute de longe', 'chutes de longe', 'chute de fora', 'bomba', 'chutador'] },
  { code: 'cabeceio', label: 'Cabeceio', positions: ['DEF', 'ATT'], keywords: ['cabeceio', 'cabeceador', 'cabeca', 'cabecada'] },
  { code: 'duelosAereos', label: 'Duelos aéreos', positions: ['DEF', 'MID', 'ATT'], keywords: ['jogo aereo', 'bola aerea', 'aereo', 'alto', 'grandao'] },
  { code: 'drible', label: 'Drible', positions: ['DEF', 'MID', 'ATT'], keywords: ['drible', 'driblador', 'dribla', 'habilidoso', 'um contra um', '1x1', '1v1', 'ginga'] },
  { code: 'controleDeBola', label: 'Controle de bola', positions: ['DEF', 'MID', 'ATT'], keywords: ['controle de bola', 'dominio', 'tecnico', 'tecnica', 'primeiro toque'] },
  { code: 'velocidade', label: 'Velocidade', positions: ['DEF', 'MID', 'ATT'], keywords: ['rapido', 'veloz', 'velocidade', 'arranque', 'explosivo', 'profundidade', 'contra-ataque'] },
  { code: 'passe', label: 'Passe', positions: ['GK', 'DEF', 'MID', 'ATT'], keywords: ['passe', 'passador', 'bom passe', 'distribuicao', 'saida de bola', 'construcao'] },
  { code: 'passesDecisivos', label: 'Passes decisivos', positions: ['MID', 'ATT'], keywords: ['passe decisivo', 'passes decisivos', 'assistencia', 'assistencias', 'garcom', 'ultimo passe'] },
  { code: 'criacao', label: 'Criação de jogadas', positions: ['MID', 'ATT'], keywords: ['criativo', 'criacao', 'visao de jogo', 'visao', 'armador', 'cerebral', 'playmaker', 'meia classico'] },
  { code: 'cruzamentos', label: 'Cruzamentos', positions: ['DEF', 'MID', 'ATT'], keywords: ['cruzamento', 'cruzamentos', 'cruza bem', 'bola na area'] },
  { code: 'desarme', label: 'Desarme', positions: ['DEF', 'MID'], keywords: ['desarme', 'desarma', 'marcador', 'marcacao', 'ladrao de bola', 'combativo'] },
  { code: 'interceptacao', label: 'Interceptação', positions: ['DEF', 'MID'], keywords: ['interceptacao', 'intercepta', 'leitura de jogo', 'antecipacao', 'antecipa'] },
  { code: 'posicionamento', label: 'Posicionamento', positions: ['GK', 'DEF', 'MID'], keywords: ['posicionamento', 'bem posicionado', 'cobertura', 'seguro', 'tatico'] },
  { code: 'duelosNoChao', label: 'Duelos no chão', positions: ['DEF', 'MID', 'ATT'], keywords: ['forte', 'fisico', 'robusto', 'duelos', 'brigador', 'pivo', 'imposicao'] },
  { code: 'intensidade', label: 'Intensidade', positions: ['DEF', 'MID', 'ATT'], keywords: ['intenso', 'intensidade', 'incansavel', 'folego', 'pressao', 'pressing', 'box to box', 'motor', 'raca'] },
  { code: 'bolaParada', label: 'Bola parada', positions: ['DEF', 'MID', 'ATT'], keywords: ['bola parada', 'falta', 'faltas', 'cobrador', 'escanteio', 'penalti', 'penaltis'] },
  { code: 'consistencia', label: 'Consistência', positions: ['GK', 'DEF', 'MID', 'ATT'], keywords: ['regular', 'consistente', 'constante', 'confiavel'] },
  { code: 'reflexos', label: 'Reflexos', positions: ['GK'], keywords: ['reflexo', 'reflexos', 'pegador', 'elasticidade', 'defesas dificeis'] },
  { code: 'saidasDoGol', label: 'Saídas do gol', positions: ['GK'], keywords: ['saida do gol', 'saidas do gol', 'sai bem', 'bolas altas', 'jogo aereo do goleiro'] },
  { code: 'jogoComOsPes', label: 'Jogo com os pés', positions: ['GK'], keywords: ['jogo com os pes', 'goleiro linha', 'reposicao', 'bom com os pes'] },
];

export const CHARACTERISTIC_LABELS = Object.fromEntries(CHARACTERISTICS.map((c) => [c.code, c.label]));

const BY_CODE = new Map(CHARACTERISTICS.map((c) => [c.code, c]));
export const getCharacteristic = (code) => BY_CODE.get(code) || null;

export function characteristicsForGroup(group) {
  return CHARACTERISTICS.filter((c) => c.positions.includes(group));
}
