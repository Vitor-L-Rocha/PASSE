import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const tmdataDirectory = (directory = process.env.PASSE_TMDATA_DIR) =>
  path.resolve(PROJECT_ROOT, directory || '.cache/tmdata');
// Dados recentes da API-Football (scripts/sync-apifootball.js).
export const apiFootballDirectory = (directory = process.env.PASSE_API_FOOTBALL_DIR) =>
  path.resolve(PROJECT_ROOT, directory || '.cache/apifootball');
// Dados da temporada atual da GOAL API (scripts/sync-goalapi.js).
export const goalApiDirectory = (directory = process.env.PASSE_GOAL_API_DIR) =>
  path.resolve(PROJECT_ROOT, directory || '.cache/goalapi');
