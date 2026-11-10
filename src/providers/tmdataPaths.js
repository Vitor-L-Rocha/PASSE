import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const tmdataDirectory = (directory = process.env.PASSE_TMDATA_DIR) =>
  path.resolve(PROJECT_ROOT, directory || '.cache/tmdata');
