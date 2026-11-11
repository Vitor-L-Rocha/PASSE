// Os testes usam o dataset fictício (determinístico e offline), a menos que
// PASSE_PROVIDERS seja definido explicitamente.
process.env.PASSE_PROVIDERS ??= 'demo';

// Sem espaçamento entre consultas nas APIs simuladas dos testes.
process.env.PASSE_API_FOOTBALL_INTERVAL_MS ??= '0';
