// Países suportados e seus continentes (confederações aproximadas).
// O "país" de um jogador no PASSE é o país da LIGA em que ele atua, não a nacionalidade.

export const CONTINENTS = {
  SA: 'América do Sul',
  NA: 'América do Norte, Central e Caribe',
  EU: 'Europa',
  AF: 'África',
  AS: 'Ásia',
  OC: 'Oceania',
};

export const COUNTRIES = [
  // América do Sul
  { code: 'BR', name: 'Brasil', continent: 'SA' },
  { code: 'AR', name: 'Argentina', continent: 'SA' },
  { code: 'UY', name: 'Uruguai', continent: 'SA' },
  { code: 'CO', name: 'Colômbia', continent: 'SA' },
  { code: 'CL', name: 'Chile', continent: 'SA' },
  { code: 'PY', name: 'Paraguai', continent: 'SA' },
  { code: 'EC', name: 'Equador', continent: 'SA' },
  { code: 'PE', name: 'Peru', continent: 'SA' },
  { code: 'VE', name: 'Venezuela', continent: 'SA' },
  { code: 'BO', name: 'Bolívia', continent: 'SA' },
  // América do Norte / Central
  { code: 'US', name: 'Estados Unidos', continent: 'NA' },
  { code: 'MX', name: 'México', continent: 'NA' },
  { code: 'CA', name: 'Canadá', continent: 'NA' },
  { code: 'CR', name: 'Costa Rica', continent: 'NA' },
  // Europa
  { code: 'PT', name: 'Portugal', continent: 'EU' },
  { code: 'ES', name: 'Espanha', continent: 'EU' },
  { code: 'GB', name: 'Inglaterra', continent: 'EU' },
  { code: 'FR', name: 'França', continent: 'EU' },
  { code: 'DE', name: 'Alemanha', continent: 'EU' },
  { code: 'IT', name: 'Itália', continent: 'EU' },
  { code: 'NL', name: 'Holanda', continent: 'EU' },
  { code: 'BE', name: 'Bélgica', continent: 'EU' },
  { code: 'TR', name: 'Turquia', continent: 'EU' },
  { code: 'GR', name: 'Grécia', continent: 'EU' },
  { code: 'CH', name: 'Suíça', continent: 'EU' },
  { code: 'AT', name: 'Áustria', continent: 'EU' },
  { code: 'DK', name: 'Dinamarca', continent: 'EU' },
  { code: 'UA', name: 'Ucrânia', continent: 'EU' },
  { code: 'RS', name: 'Sérvia', continent: 'EU' },
  { code: 'HR', name: 'Croácia', continent: 'EU' },
  // África
  { code: 'EG', name: 'Egito', continent: 'AF' },
  { code: 'MA', name: 'Marrocos', continent: 'AF' },
  { code: 'ZA', name: 'África do Sul', continent: 'AF' },
  { code: 'NG', name: 'Nigéria', continent: 'AF' },
  // Ásia
  { code: 'SA', name: 'Arábia Saudita', continent: 'AS' },
  { code: 'JP', name: 'Japão', continent: 'AS' },
  { code: 'KR', name: 'Coreia do Sul', continent: 'AS' },
  { code: 'QA', name: 'Catar', continent: 'AS' },
  { code: 'AE', name: 'Emirados Árabes', continent: 'AS' },
  { code: 'CN', name: 'China', continent: 'AS' },
  // Oceania
  { code: 'AU', name: 'Austrália', continent: 'OC' },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function getCountry(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || null;
}

export function continentOf(code) {
  return getCountry(code)?.continent || null;
}
