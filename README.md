# PASSE
PASSE (Plataforma de Auxílio ao Scouting para Sociedades Esportivas) surge como uma alternativa de facilitar o trabalho de pesquisa por jogadores para profissionais de direção esportiva de clubes. Atuando conforme as suas preferências específicas e gerando um relatório daqueles que mais se enquadram.

## Provedores de dados

Node 20.6+ e `npm install`. Copie `.env.example` para `.env`, configure as fontes
e execute `node --env-file=.env src/server.js`. `npm start` usa somente as variáveis
já exportadas no ambiente. O padrão `PASSE_PROVIDERS=demo` usa dados fictícios.

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

Ative fontes com `PASSE_PROVIDERS=demo,transfermarkt,api-football`. Fontes sem
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
