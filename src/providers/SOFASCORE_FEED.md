# Contrato do feed autorizado SofaScore

Este adaptador **não consulta a API interna/pública protegida do site**. É preciso
um fornecedor com licença/acordo que exponha este contrato, ou adaptar o serviço
licenciado para ele. Os caminhos abaixo são definidos pelo PASSE e não são uma
promessa de compatibilidade com endpoints privados SofaScore. Não configure um
relay para burlar 403. Sem `PASSE_SOFASCORE_AUTHORIZED=true` e uma URL válida,
não há chamadas. Os domínios protegidos `sofascore.*` são recusados pela proteção
compartilhada; caso um acordo oficial forneça um domínio hoje bloqueado, revise
explicitamente essa proteção com o contrato antes de habilitá-lo.

Configuração e autenticação: `.env.example`; token opcional é enviado como
`Authorization: Bearer ...`. Cache, timeout, rate limit e pausa após 403/429 usam
o mesmo cliente dos demais provedores. Não há troca de identidade de cliente,
browser, proxy, spoofing ou repetição automática para contornar bloqueios.

## Transporte

- `GET {baseUrl}/players?position=ST&maxBudgetEur=1000000&cursor=...` retorna
  `{ "players": [...], "nextCursor": null }`. Cursor é opcional na primeira página;
  a última deve retornar `nextCursor` ausente/null. Páginas repetidas ou excesso
  de páginas falham explicitamente. O PASSE reaplica posição/orçamento localmente.
- `GET {baseUrl}/players/{sofascoreId}` retorna `{ "player": {...} }`, ou
  `{ "player": null }` para jogador ausente. O `id` deve corresponder ao solicitado.
  Um feed apenas de enriquecimento pode omitir os campos de identidade além de
  `id`, mantendo os campos do dashboard. Nesse caso ele não serve para busca.

Exemplo fictício do objeto `player`:

```json
{
  "id": "123",
  "name": "Jogador",
  "age": 24,
  "nationality": "Argentina",
  "position": "ST",
  "foot": "right",
  "heightCm": 182,
  "club": "Clube",
  "league": "Liga",
  "leagueCountry": "BR",
  "marketValueEur": 900000,
  "contractUntil": null,
  "season": "2026",
  "appearances": 20,
  "minutes": 1500,
  "stats": { "goals": 0.6 },
  "photoUrl": "https://media.licensed.example/player-123.jpg",
  "links": { "sofascore": "https://www.sofascore.com/football/player/jogador/123" },
  "characteristics": { "positive": [{ "type": "finishing" }], "negative": ["tackling"] },
  "seasons": [{ "season": "2026", "club": "Clube", "league": "Liga", "appearances": 20, "minutes": 1500, "goals": 10, "assists": 2, "rating": 7.1 }],
  "titles": [{ "name": "Campeonato", "season": "2025", "club": "Clube" }],
  "heatmap": { "season": "2026", "competition": "Liga", "points": [{ "x": 80, "y": 40, "count": 3 }] }
}
```

`leagueCountry` é o ISO-2 do país **da liga**, de `src/data/countries.js`, nunca
o país de nascimento/cidadania. Posições amplas são ignoradas; use códigos PASSE
ou especializações reconhecidas. Não invente valor de mercado: `null` não passa
em busca com teto. `stats` já deve estar em taxas /90 e percentuais do contrato
PASSE. `seasons` contém totais observados por temporada/time/competição; `rating`
é a nota média fornecida pela fonte, preservada sem conversão em competência
0–100. Campos ausentes ficam null/[]; não estimamos conquistas ou competências.

## Características e mapa de calor

Positivos/negativos aceitam um tipo string/number ou `{ "type": ... }`. Códigos
PASSE são aceitos diretamente. Rótulos ingleses convencionados no adaptador estão
em `LABELS` de `sofascoreProvider.js`. **Não representam uma enumeração oficial**.
Para os tipos numéricos ou nomes próprios do seu fornecedor, configure
`PASSE_SOFASCORE_TYPE_MAP`, por exemplo `{"101":"finalizacao"}` (ID fictício).
Valide o mapa com a documentação do fornecedor; códigos PASSE inválidos
desabilitam o provedor. Tipos desconhecidos são ignorados, duplicatas removidas,
contradições forte/fraco descartadas. Sem característica reconhecida, retorna
`null` para permitir derivação pelo núcleo; listas explicitamente vazias são
preservadas. O campo normalizado `source` é `fonte`.

O feed deve normalizar a orientação do mapa: `x` é o comprimento do campo,
ataque à direita, `y` é a largura, ambos 0–100. Não presumimos orientação para
coordenadas de partidas brutas. Pontos inválidos são ignorados; `count` ausente
vale 1; count deve ser positivo. Nenhum ponto válido resulta em `heatmap=null`.
Temporada/competição acompanham os pontos sem inventar cobertura temporal.

## Interface de enriquecimento para o servidor

```js
import { enrichPlayerWithSofascore } from './providers/sofascoreProvider.js';
const enriched = await enrichPlayerWithSofascore(player, { sofascoreId: '123' });
```

Ou omita o segundo argumento e use
`PASSE_SOFASCORE_PLAYER_IDS={"transfermarkt-7":"123"}`. Não existe associação
automática por nome. Essa chamada explícita usa a autorização/configuração do
feed; não depende de `PASSE_PROVIDERS` (que seleciona as fontes da busca).
Para o índice CC0, configure `{"tmdata-7":"123"}` explicitamente; uma associação
`transfermarkt-7` não é herdada por `tmdata-7`. A lista de características
pesquisáveis só é ampliada pelo enriquecedor quando há associação de IDs para
alguma fonte ativa; URL/autorização isoladamente não bastam.

Preserva `id`, `source`, clube, liga, posição, valor, stats e demais campos da
fonte primária. Acrescenta/substitui características e mapa de calor quando o
feed os fornece, acrescenta o link SofaScore e preenche foto, temporadas e títulos
somente quando os campos primários estão vazios. Não combina totais de fontes
diferentes. Feed parcial serve para isso. Sem associação/configuração, jogador
ausente, identidade divergente ou falha/403, devolve o jogador original. O cliente
mantém a pausa por bloqueio; a falha opcional não derruba o detalhe principal.

## Outros provedores

Transfermarkt: detalhes tentam `/players/{id}/stats`, `/achievements` e, se a foto
do elenco estiver ausente, `/profile`. Falha desses complementos mantém a ficha
básica. Histórico preserva linhas por temporada/clube/competição; nomes de clubes
fora do catálogo configurado ficam null. A fonte não informa rating, então null.
Conquistas usam `title`, `details[].season` e `details[].club` do schema v4; sem
detalhes, título é mantido uma vez sem inventar temporadas ou repetir `count`.

API-Football: foto vem de `player.photo`; temporadas vêm das linhas `statistics`
recebidas em `/players` na temporada configurada, com time, competição, totais e
`games.rating` da fonte. Não fazemos uma varredura de toda a carreira nem
buscamos temporadas que não foram retornadas pelo plano/endpoint.
