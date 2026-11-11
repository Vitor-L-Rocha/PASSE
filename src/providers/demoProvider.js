import { generateDemoPlayers } from '../data/demoDataset.js';

export const demoProvider = {
  name: 'demo',
  label: 'Dados de demonstração (fictícios)',
  isEnabled: () => true,
  async searchPlayers({ position, maxBudgetEur } = {}) {
    return generateDemoPlayers().filter(
      (p) => (!position || p.position === position) && (!maxBudgetEur || p.marketValueEur <= maxBudgetEur)
    );
  },
  async getPlayer(id) {
    return generateDemoPlayers().find((p) => p.id === id) || null;
  },
};
