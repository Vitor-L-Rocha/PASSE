# PASSE
PASSE (Plataforma de Auxílio ao Scouting para Sociedades Esportivas) surge como uma alternativa de facilitar o trabalho de pesquisa por jogadores para profissionais de direção esportiva de clubes. Atuando conforme as suas preferências específicas e gerando um relatório daqueles que mais se enquadram.

## Começando

```bash
npm install
npm start      # na primeira vez baixa os dados reais (~55 MB) e abre em http://localhost:3000
npm test
```

## Dados reais (fonte padrão)

O PASSE usa por padrão o projeto aberto
[transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets),
publicado em domínio público (**CC0 1.0**). `npm run sync-data` baixa as tabelas e
gera um índice local em `.cache/tmdata/players.json` (fora do Git), com cerca de
**24 mil jogadores em atividade de 31 ligas** (Brasil, Argentina, México, MLS,
Japão, Coreia, Arábia Saudita, Austrália e as principais da Europa).

- **Para todos os jogadores:** nome, idade, posição detalhada, pé, altura, clube, liga,
  valor de mercado, fim de contrato, nacionalidade e foto.
- **Gols, assistências e minutos por temporada:** só para as ligas europeias em que o
  dataset registra cada partida. Nas demais (Brasileirão, por exemplo) o jogador aparece
  no relatório marcado como "sem dados de desempenho nesta fonte".
- **Características avaliáveis:** finalização e criação de jogadas (gols e assistências
  por 90 minutos, nas duas últimas temporadas, com no mínimo 450 minutos). As demais
  dependem de uma fonte com estatísticas detalhadas (feed SofaScore autorizado ou
  API-Football); a interface só oferece o que as fontes ativas conseguem avaliar.
- **Não disponíveis nesta fonte:** mapa de calor e títulos.
- O dataset está atualizado até **julho de 2026**; o mantenedor pausou as coletas. Rode
  `npm run sync-data` de novo para pegar atualizações quando voltarem.

Sem o índice, o PASSE usa jogadores fictícios (`demo`), também usados nos testes.

## Outros provedores de dados

Node 20.6+ e `npm install`. Copie `.env.example` para `.env`, configure as fontes
e execute `node --env-file=.env src/server.js`. `npm start` usa somente as variáveis
já exportadas no ambiente. Sem `PASSE_PROVIDERS`, o padrão é `tmdata` (dados reais acima).

- `transfermarkt`: adaptador para uma instância **autorizada** do
  [transfermarkt-api v4](https://github.com/felipeall/transfermarkt-api).
  Configure URL, confirmação de direitos, temporada e catálogo de clubes em
  `.env.example`. O catálogo informa explicitamente a liga e seu país ISO-2 de
  `src/data/countries.js`. Não usa cidadania para definir mercado. Somente posições
  específicas reconhecidas são aceitas. Estatísticas opcionais consultam
  `/players/{id}/stats`, limitadas à temporada, clube e competição configurados;
  gols/assistências são convertidos por 90 minutos. Sem elas o ranking usa os
  atributos neutros do núcleo e não representa uma avaliação técnica observada.
- `api-football`: integração com a [API-Sports v3 oficial](https://www.api-football.com/documentation-v3),
  endpoint `/players` com chave `x-apisports-key`, catálogo de ligas e temporada.
  Busca todas as páginas dentro do limite configurado; excedê-lo produz erro
  explícito em vez de entregar uma amostra incompleta silenciosamente. O plano
  deve cobrir a temporada/ligas desejadas. A API não oferece valor de mercado e
  agrupa posições de linha; use `PASSE_API_FOOTBALL_METADATA` para dados curados
  de valor/posição. Sem valor conhecido, o jogador não passa pelo teto de orçamento;
  sem posição específica não entra na busca. Não interpretamos `passes.accuracy`
  como percentual: o campo representa média de passes certos. Dados ausentes
  continuam ausentes, inclusive pé preferencial e contrato.

Ative fontes com `PASSE_PROVIDERS=tmdata,transfermarkt,api-football`. Fontes sem
configuração válida ficam desabilitadas e não fazem chamadas. Detalhes são
resolvidos apenas entre fontes ativas. Erros de uma fonte aparecem em
`providerErrors`, preservando resultados das demais. IDs são únicos por fonte;
não há fusão automática de uma pessoa entre serviços.

As integrações usam cache em memória e JSON em `.cache/providers/`, TTL,
coalescência de requisições simultâneas, timeout e fila por fonte. A fila limita
chamadas neste processo; múltiplas réplicas precisam de um limitador compartilhado.
403/401/429 abrem uma pausa de pelo menos 60 segundos (`Retry-After` é respeitado).
Não há retry automático nem contorno de bloqueios. Não execute manutenção do
cache durante buscas; para remover dados em disco, pare o processo antes. O TTL
define validade de leitura, não exclusão física: ajuste retenção/limpeza à licença.

Não há integração direta com SofaScore, por restrições de acesso automatizado.
O código não consulta sites protegidos nem usa mecanismos anti-bot. Hospedar
transfermarkt-api não concede direitos sobre os dados: verifique os
[termos do Transfermarkt](https://www.transfermarkt.com/intern/anb) e robots da
origem, além das permissões contratuais da sua API. A confirmação de autorização
é uma configuração do operador, não uma verificação automática de direitos.

## Validação

`npm test` executa testes offline do núcleo e dos provedores, com respostas HTTP
simuladas, sem chaves nem acesso às plataformas externas.

## Como funciona

O PASSE **não dá notas de competência** aos jogadores. Cada atleta é descrito por
**características** (pontos fortes e pontos fracos, no estilo do SofaScore), e o
relatório cruza essas características com o que o clube procura.

1. **Início**: o usuário informa a **posição**, o **lugar** (país do seu clube), o
   **valor esperado** (teto de valor de mercado, em €) e seleciona/descreve as
   **características** desejadas. Pé, idade e altura escritos no texto viram filtros.
2. **Relatório**: o PASSE consulta as fontes ativas, aplica posição, orçamento e
   filtros, e ordena por encaixe: quantas características pedidas são pontos fortes
   do jogador, quantas são pontos fracos e, no empate, o menor valor. Não é um
   ranking de "melhores". Os jogadores ficam em três abas, sempre pelo **país da
   liga onde o atleta joga** (não pela nacionalidade):
   - **Nacional**: mesmo país do clube
   - **Continental**: outro país do mesmo continente
   - **Global**: demais continentes
3. **Jogador**: foto, nome, idade, time, posição e pé; **mapa de calor**; **time e
   estatística por temporada**; **títulos**; e **características**.

As características vêm da fonte quando ela fornece (feed autorizado do SofaScore).
Caso contrário, são derivadas das estatísticas por 90 minutos, comparadas a
jogadores da mesma função; a ficha indica qual foi o caso. A nota média exibida nas
temporadas é a da fonte, nunca calculada pelo PASSE.

### Enriquecimento SofaScore

Jogadores de outras fontes (Transfermarkt, API-Football) podem receber
características e mapa de calor do feed SofaScore autorizado associando IDs em
`PASSE_SOFASCORE_PLAYER_IDS` (ex.: `{"transfermarkt-7":"123"}`). O enriquecimento
acontece antes do ranking, então o relatório e a ficha usam as mesmas
características. Sem configuração, nada é consultado. Contrato do feed:
`src/providers/SOFASCORE_FEED.md`.

## Arquitetura

```
src/
  server.js              API Express + arquivos estáticos
  core/criteria.js       seleção + texto livre -> características desejadas + filtros
  core/characteristics.js características da fonte ou derivadas das estatísticas
  core/attributes.js     apoio interno à derivação (não exposto ao usuário)
  core/matcher.js        ranking por encaixe de características
  core/markets.js        classificação nacional / continental / global
  data/characteristics.js vocabulário de características
  data/countries.js      países e continentes
  data/positions.js      posições e perfil base de cada uma
  data/demoDataset.js    jogadores FICTÍCIOS para desenvolvimento
  providers/             fontes de dados plugáveis (contrato em providers/index.js)
scripts/sync-data.js     download e indexação dos dados reais (transfermarkt-datasets, CC0)
public/                  frontend em 3 telas (#/, #/relatorio, #/jogador/:id), sem build
test/                    testes (node:test)
```

### API

- `GET /api/meta`: países, posições, vocabulário de características e mercados
- `POST /api/search` com `{ country, maxBudgetEur, position, selectedCharacteristics: [códigos], characteristics: "texto livre" }`
- `GET /api/players/:id`: ficha completa (temporadas, títulos, mapa de calor, características)

### Fontes de dados

Os provedores são selecionados pela variável `PASSE_PROVIDERS` (padrão: `tmdata`, dados reais; `demo` se o índice não existir).
As integrações com fontes externas (Transfermarkt, SofaScore etc.) precisam respeitar os termos de uso de cada
plataforma. A configuração dos provedores disponíveis está em `.env.example`.
