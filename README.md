# PASSE
PASSE (Plataforma de Auxílio ao Scouting para Sociedades Esportivas) surge como uma alternativa de facilitar o trabalho de pesquisa por jogadores para profissionais de direção esportiva de clubes. Atuando conforme as suas preferências específicas e gerando um relatório daqueles que mais se enquadram.

## Como funciona

1. O usuário escolhe o **país do seu clube**, o **teto orçamentário** (valor de mercado máximo, em €), a **posição** e escreve as **características** desejadas em texto livre (ex.: "ponta rápido, canhoto, driblador, até 23 anos").
2. O PASSE consulta os provedores de dados ativos, filtra por posição, orçamento e filtros objetivos (pé, idade, altura) e calcula um índice de **aderência ao perfil** (0–100). Ele mede o encaixe no perfil pedido, não a qualidade geral do jogador.
3. Os resultados são separados em três mercados, sempre pelo **país da liga onde o atleta joga** (não pela nacionalidade):
   - **Interno**: mesmo país do clube
   - **Externo**: outro país do mesmo continente
   - **Internacional**: demais continentes
4. Ao clicar em um jogador, abre um **dashboard** com dados de mercado e contrato, radar de atributos e estatísticas da temporada.

## Rodando

```bash
npm install
npm start          # http://localhost:3000 (PORT=4317 npm start para usar outra porta)
npm test
```

## Arquitetura

```
src/
  server.js              API Express + arquivos estáticos
  core/criteria.js       texto livre -> pesos de atributos + filtros
  core/attributes.js     estatísticas /90 -> atributos 0–100
  core/matcher.js        índice de aderência e ranking
  core/markets.js        classificação interno / externo / internacional
  data/countries.js      países e continentes
  data/positions.js      posições e perfil base de cada uma
  data/demoDataset.js    jogadores FICTÍCIOS para desenvolvimento
  providers/             fontes de dados plugáveis (contrato em providers/index.js)
public/                  frontend (HTML/CSS/JS, sem build)
test/                    testes (node:test)
```

### API

- `GET /api/meta`: países, posições, atributos e mercados
- `POST /api/search` com `{ country, maxBudgetEur, position, characteristics }`
- `GET /api/players/:id`: detalhe para o dashboard

### Fontes de dados

Os provedores são selecionados pela variável `PASSE_PROVIDERS` (padrão: `demo`, com jogadores fictícios).
As integrações com fontes externas (Transfermarkt, SofaScore etc.) precisam respeitar os termos de uso de cada
plataforma. A configuração dos provedores disponíveis está em `.env.example`.
