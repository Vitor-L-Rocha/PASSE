// Posições e o "perfil base" de atributos que importam para cada uma.
// Os pesos são usados quando o usuário escreve poucas características,
// para que o ranking ainda reflita o que a posição exige.

export const ATTRIBUTES = {
  velocidade: 'Velocidade',
  finalizacao: 'Finalização',
  passe: 'Passe',
  visao: 'Visão de jogo',
  drible: 'Drible',
  defesa: 'Defesa',
  jogoAereo: 'Jogo aéreo',
  fisico: 'Físico',
  intensidade: 'Intensidade',
  goleiro: 'Goleiro',
};

export const POSITIONS = [
  { code: 'GK', name: 'Goleiro', group: 'GK', base: { goleiro: 3, jogoAereo: 1, passe: 0.5 } },
  { code: 'CB', name: 'Zagueiro', group: 'DEF', base: { defesa: 3, jogoAereo: 2, fisico: 1.5, passe: 0.5 } },
  { code: 'LB', name: 'Lateral esquerdo', group: 'DEF', base: { velocidade: 2, defesa: 1.5, passe: 1, intensidade: 1.5 } },
  { code: 'RB', name: 'Lateral direito', group: 'DEF', base: { velocidade: 2, defesa: 1.5, passe: 1, intensidade: 1.5 } },
  { code: 'DM', name: 'Volante', group: 'MID', base: { defesa: 2.5, passe: 1.5, intensidade: 2, fisico: 1 } },
  { code: 'CM', name: 'Meio-campista', group: 'MID', base: { passe: 2.5, visao: 1.5, intensidade: 1.5, defesa: 0.5 } },
  { code: 'AM', name: 'Meia ofensivo', group: 'MID', base: { visao: 2.5, passe: 2, drible: 1.5, finalizacao: 1 } },
  { code: 'LW', name: 'Ponta esquerda', group: 'ATT', base: { velocidade: 2.5, drible: 2.5, finalizacao: 1, passe: 0.5 } },
  { code: 'RW', name: 'Ponta direita', group: 'ATT', base: { velocidade: 2.5, drible: 2.5, finalizacao: 1, passe: 0.5 } },
  { code: 'ST', name: 'Centroavante', group: 'ATT', base: { finalizacao: 3, jogoAereo: 1, fisico: 1, velocidade: 0.5 } },
];

const BY_CODE = new Map(POSITIONS.map((p) => [p.code, p]));

export function getPosition(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || null;
}
