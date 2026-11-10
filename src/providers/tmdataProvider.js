// Provedor de dados REAIS a partir do índice local gerado por scripts/sync-data.js
// (projeto aberto transfermarkt-datasets, licença CC0). Não faz requisições em tempo
// de busca: lê o arquivo .cache/tmdata/players.json, atualizado com `npm run sync-data`.
//
// Cobertura: ~24 mil jogadores em atividade em 31 ligas (perfil, clube, valor de mercado,
// contrato, foto). Gols/assistências por partida existem apenas para as principais ligas
// europeias; por isso só "finalizacao" e "criacao" podem ser derivadas desta fonte.

import fs from 'node:fs';
import path from 'node:path';

const indexFile = () => path.resolve(process.env.PASSE_TMDATA_DIR || '.cache/tmdata', 'players.json');

let loaded = null; // { file, mtimeMs, index, byId }

function load() {
  const file = indexFile();
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (loaded && loaded.file === file && loaded.mtimeMs === stat.mtimeMs) return loaded;
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(index?.players)) throw new Error('Índice de dados reais inválido; rode npm run sync-data.');
  loaded = { file, mtimeMs: stat.mtimeMs, index, byId: new Map(index.players.map((p) => [p.id, p])) };
  return loaded;
}

export const tmdataProvider = {
  name: 'tmdata',
  label: 'transfermarkt-datasets (dados abertos, CC0)',
  // Características que as estatísticas desta fonte conseguem sustentar.
  characteristics: ['finalizacao', 'criacao'],
  isEnabled: () => fs.existsSync(indexFile()),
  info() {
    const l = load();
    return l ? { ...l.index.source, generatedAt: l.index.generatedAt, players: l.index.players.length } : null;
  },
  async searchPlayers({ position, maxBudgetEur } = {}) {
    const l = load();
    if (!l) throw new Error('Dados reais ainda não sincronizados. Rode: npm run sync-data');
    const pos = position ? String(position).toUpperCase() : null;
    return l.index.players.filter(
      (p) => (!pos || p.position === pos) && (maxBudgetEur == null || (p.marketValueEur != null && p.marketValueEur <= maxBudgetEur))
    );
  },
  async getPlayer(id) {
    return load()?.byId.get(id) || null;
  },
};
