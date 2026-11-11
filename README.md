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
**24 mil jogadores em atividade no snapshot de 31 ligas** (Brasil, Argentina, México, MLS,
Japão, Coreia, Arábia Saudita, Austrália e as principais da Europa).

- **Para todos os jogadores:** nome, idade, posição detalhada, pé, altura, clube, liga,
  valor de mercado, fim de contrato, nacionalidade e foto.
- **Gols, assistências e minutos por temporada:** a cobertura de atuações é parcial,
  concentrada nas ligas europeias. Jogadores transferidos podem ter estatísticas de
  clubes anteriores. Sem estatísticas utilizáveis, o relatório marca o jogador como
  "sem dados de desempenho nesta fonte". O histórico separa clube, competição e
  temporada; não atribui totais de copas ao nome de uma liga. Taxas por 90 somam
  clubes/competições do mesmo período, com pelo menos 450 minutos, sem misturar
  temporadas de ano civil e temporadas europeias só porque têm o mesmo ID bruto.
- **Características avaliáveis:** finalização e criação de jogadas (gols e assistências
  por 90 minutos, nas duas últimas temporadas, com no mínimo 450 minutos). As demais
  dependem de uma fonte com estatísticas detalhadas (feed SofaScore autorizado ou
  API-Football); a interface só oferece o que as fontes ativas conseguem avaliar.
- **Não disponíveis nesta fonte:** mapa de calor e títulos.
- O dataset está atualizado até **julho de 2026**; o mantenedor pausou as coletas. Rode
  `npm run sync-data` de novo para pegar atualizações quando voltarem.
  Clube, contrato e valor refletem esse snapshot, não confirmação em tempo real.
  `generatedAt` é a geração local; `source.lastGameDate` e `lastAppearanceDate`
  indicam as datas dos jogos e atuações efetivamente usados no índice.

Sem índice válido, a seleção automática usa jogadores fictícios (`demo`), também
usados nos testes. `PASSE_PROVIDERS=tmdata` exige explicitamente a fonte real e
não troca para demo. Diretório relativo em `PASSE_TMDATA_DIR` é resolvido a partir
da raiz do projeto, igualmente no sync e no servidor. O índice schema v2 é gravado
atomicamente; falhas de parsing/download preservam o anterior. `npm start`
reconstrói índices antigos/inválidos; `npm run sync-data` reconstrói a qualquer
momento (reutilizando os CSVs válidos em cache por sete dias).

## Dados recentes, mais características e títulos (API-Football)

O índice acima é uma foto de julho de 2026. Para trazer a **temporada atual**, use
a [API-Football](https://www.api-football.com) (API-Sports v3, acesso oficial; plano
grátis com 100 consultas por dia):

1. Crie a conta grátis em https://dashboard.api-football.com e copie a chave.
2. Copie `.env.example` para `.env` e preencha `PASSE_API_FOOTBALL_KEY`.
3. `npm run sync-apifootball -- --check` confere a chave, o plano e se ele libera a
   temporada atual (o PASSE avisa se o plano só permite temporadas antigas).
4. `npm run sync-apifootball` atualiza as ligas de `PASSE_API_FOOTBALL_SYNC_LEAGUES`
   (padrão `BRA1`; o Brasileirão leva ~30 consultas). A cota é respeitada e a
   sincronização continua de onde parou na execução seguinte.

Cada jogador da API-Football é ligado ao do índice pela **data de nascimento e nome**.
Os ligados passam a ter:

- **clube atual**, jogos, minutos, gols e assistências da temporada corrente e a
  **nota média da API-Football** (exibida como nota da fonte);
- mais **características avaliáveis**: drible, passes decisivos, criação, desarme,
  interceptação, duelos no chão, consistência e reflexos (goleiros);
- **títulos** na ficha (rota `/trophies`, uma consulta por jogador, cache de 30 dias).

Valor de mercado, contrato e foto continuam vindo do índice. **Mapa de calor** não é
oferecido pela API-Football e segue indisponível. `npm start` lê o `.env` sozinho.

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
  gols/assistências são convertidos por 90 minutos. Sem elas a fonte não sustenta
  características técnicas para a busca. O detalhe tenta completar o histórico.
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

O enriquecimento SofaScore autorizado ocorre antes do ranking e também na ficha.
Para a nova fonte, associe explicitamente IDs como
`PASSE_SOFASCORE_PLAYER_IDS={"tmdata-123":"456"}`. A associação de um ID
`transfermarkt-123` não é aplicada automaticamente a `tmdata-123`. Sem associação,
configurar apenas a URL do feed não anuncia características adicionais para tmdata.
Transfermarkt e API-Football declaram somente as características sustentadas por
suas estatísticas; não anunciam todo o vocabulário. Contrato do feed licenciado e
interface do enriquecedor: [SOFASCORE_FEED.md](src/providers/SOFASCORE_FEED.md).

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
