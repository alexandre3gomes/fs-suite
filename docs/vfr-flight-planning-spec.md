# Especificação Funcional: Planejamento de Voo VFR Básico

## 1. Objetivo

Implementar a primeira feature funcional após o reset do produto: um fluxo de **planejamento de voo VFR básico**, utilizável no web, estável e sem automações prematuras.

Esta feature deve permitir ao usuário autenticado:

- selecionar aeródromos de origem, destino e alternativo
- consultar METAR dos três aeródromos
- preencher rota e referências visuais
- registrar dados básicos de autonomia/combustível
- completar um checklist de briefings operacionais
- salvar e reabrir o planejamento

## 2. Princípios de escopo

- Esta entrega deve ser **simples, confiável e honesta**.
- Não reutilizar fluxos antigos removidos do baseline.
- Não introduzir SimBrief, SkyVector, cartas automáticas, tracking, mobile sync ou IA nesta primeira entrega.
- O objetivo é entregar um primeiro módulo operacional claro, não um ecossistema completo.

## 3. Escopo da v1

### 3.1 Informações de aeródromo

Para cada aeródromo abaixo:

- origem
- destino
- alternativo

o sistema deve exibir:

- ICAO / nome do aeródromo
- elevação
- pista em uso sugerida

### 3.2 Informações de clima

O sistema deve carregar e exibir:

- METAR do aeródromo de origem
- METAR do aeródromo de destino
- METAR do aeródromo alternativo

Além do METAR bruto, a interface deve mostrar uma leitura resumida mínima:

- vento
- visibilidade
- teto / nuvens relevantes
- QNH
- categoria operacional simples: `VFR`, `MVFR`, `IFR`, `LIFR`

### 3.3 Informações de rota

Campos obrigatórios da seção:

- campo de rota do plano de voo
- referências visuais com distância e tempo entre cada uma
- nível de cruzeiro
- TOD em minutos

### 3.4 Informações de autonomia

Campos obrigatórios da seção:

- quantidade de combustível A + B + C + contingência (30/45 min) + 10%
- quantidade a abastecer por asa
- autonomia em horas/minutos

Para viabilizar a v1, o sistema pode trabalhar com estes insumos:

- consumo por hora
- combustível atual total
- reserva selecionada: `30` ou `45` minutos

E deve calcular:

- contingência adicional de `10%`
- combustível requerido total
- quantidade por asa
- autonomia final em minutos e no formato `hh:mm`

### 3.5 Briefings

O sistema deve apresentar os seguintes itens como checklist com campo opcional de observação:

- Start SimAcars
- Briefing da carta PDC dos 3 aeródromos
- Briefing da carta ADC do aeródromo de origem
- Briefing da carta ADC do aeródromo de destino
- Briefing da carta VAC ou circuito padrão do aeródromo de origem
- Briefing da carta VAC ou circuito padrão do aeródromo de destino
- Briefing de arremetida
- Compartilhar as imagens no grupo do Facebook

Nesta v1, todos os itens acima são **manuais**. Não há integração automática com cartas, SimAcars ou Facebook.

## 4. Seleção de aeródromos e mapa

### 4.1 Requisito funcional

O usuário deve conseguir selecionar origem, destino e alternativo de duas formas:

- por busca textual
- por clique em mapa

### 4.2 Solução recomendada

Não depender de uma única API externa que entregue “mapa de aeródromos” pronto.

Implementação recomendada:

- **dados aeronáuticos:** dataset do **OurAirports**
- **renderização do mapa:** **MapLibre GL JS**
- **METAR:** **AviationWeather.gov Data API**

### 4.3 Justificativa

- `OurAirports` fornece aeródromos e pistas com custo zero e boa cobertura para a etapa atual.
- `MapLibre` preserva controle da experiência e mantém a solução alinhada ao stack web-first/mobile-friendly.
- Chamar METAR via backend evita dependência direta do frontend em APIs externas.

## 5. Comportamento esperado

### 5.1 Fluxo principal

1. usuário autenticado acessa o dashboard
2. usuário entra em `Novo Planejamento VFR`
3. seleciona origem, destino e alternativo por texto ou mapa
4. sistema carrega dados dos aeródromos
5. sistema consulta METAR dos três aeródromos
6. sistema sugere pista em uso para cada aeródromo
7. usuário preenche rota, referências visuais, nível de cruzeiro e TOD
8. usuário preenche dados de combustível
9. sistema calcula autonomia
10. usuário marca os itens de briefing
11. usuário salva o planejamento
12. usuário consegue reabrir o planejamento salvo

### 5.2 Regra de pista em uso sugerida

Para cada aeródromo com METAR válido e dados de pista disponíveis:

- extrair direção do vento do METAR
- comparar com os headings das cabeceiras
- sugerir a cabeceira com menor componente de cauda

Se não houver METAR válido ou pista suficiente para sugerir com confiança:

- não sugerir automaticamente
- manter o campo editável manualmente

## 6. Modelo de dados sugerido

### 6.1 Entidade principal

`VfrFlightPlan`

Campos sugeridos:

- `id`
- `userId`
- `status` (`DRAFT`, `COMPLETED`)
- `originIcao`
- `originName`
- `originElevationFt`
- `originRunwayInUse`
- `originMetarRaw`
- `destinationIcao`
- `destinationName`
- `destinationElevationFt`
- `destinationRunwayInUse`
- `destinationMetarRaw`
- `alternateIcao`
- `alternateName`
- `alternateElevationFt`
- `alternateRunwayInUse`
- `alternateMetarRaw`
- `routeText`
- `cruiseLevel`
- `todMinutes`
- `fuelConsumptionPerHour`
- `fuelCurrentTotal`
- `fuelReserveMinutes`
- `fuelRequiredTotal`
- `fuelPerWing`
- `enduranceMinutes`
- `createdAt`
- `updatedAt`

### 6.2 Referências visuais

`VfrFlightPlanVisualReference`

Campos sugeridos:

- `id`
- `flightPlanId`
- `sequence`
- `name`
- `distanceNm`
- `timeMin`

### 6.3 Itens de briefing

`VfrFlightPlanBriefingItem`

Campos sugeridos:

- `id`
- `flightPlanId`
- `code`
- `label`
- `checked`
- `notes`

## 7. Endpoints sugeridos

### 7.1 Aeródromos

- `GET /v1/aerodromes/search?q=...`
- `GET /v1/aerodromes/:icao`
- `GET /v1/aerodromes/map?bbox=...`

### 7.2 Clima

- `GET /v1/weather/metar?icaos=SBSP,SBGR,SBKP`

### 7.3 Planejamento VFR

- `POST /v1/vfr-flight-plans`
- `GET /v1/vfr-flight-plans`
- `GET /v1/vfr-flight-plans/:id`
- `PATCH /v1/vfr-flight-plans/:id`
- `DELETE /v1/vfr-flight-plans/:id`

## 8. UI proposta

Estruturar a tela em blocos:

- `Aeródromos`
- `Clima`
- `Rota`
- `Autonomia`
- `Briefings`
- `Resumo`

Diretrizes de interface:

- busca textual com resposta rápida
- mapa com marcadores de aeródromos e seleção por clique
- campos calculados claramente diferenciados de campos editáveis
- sem placeholders enganosos
- sem módulos paralelos ou navegação residual do sistema antigo

## 9. Dependências externas aprovadas para estudo/integração

### 9.1 OurAirports

Uso recomendado:

- ingestão periódica de `airports.csv`
- ingestão de `runways.csv`
- persistência local para busca e uso no mapa

### 9.2 AviationWeather.gov

Uso recomendado:

- consulta server-side de METAR
- cache curto para reduzir chamadas repetidas

### 9.3 MapLibre GL JS

Uso recomendado:

- renderização do mapa web
- markers/points de aeródromos com seleção interativa

## 10. Fora de escopo desta v1

- SimBrief
- SkyVector
- cartas automáticas
- integração com Facebook
- integração automática com SimAcars
- cálculo geográfico avançado da rota
- sync em tempo real
- tracking
- sugestões por IA
- experiência mobile dedicada

## 10.1 Estado atual aceito da implementação

Em 2026-04-22, após avaliação funcional do usuário, o estado atual da implementação VFR foi considerado **aceitável como baseline funcional provisório**, mesmo contendo avanços além do escopo enxuto inicialmente descrito.

Isso significa:

- não remover automaticamente o que já foi implementado
- não tratar a implementação expandida como erro de produto por si só
- usar o estado atual como base de continuidade
- retomar o controle do projeto por micro-specs pequenas daqui em diante

### Funcionalidades atualmente aceitas como parte do baseline provisório

- rotas `vfr-plans`
- dashboard com entrada para planejamento VFR
- busca textual de aeródromos
- seleção de aeródromos em mapa
- exibição de dados básicos de aeródromo
- integração de METAR via backend
- criação/listagem/reabertura de planos VFR
- estrutura de rota e referências visuais
- autonomia e briefings manuais
- integração SkyVector (companion VFR mundial/EUA): exportar/abrir a rota no SkyVector e importar plano `.fpl` (ver §10.2)
- recursos adicionais já implementados no fluxo VFR, desde que não bloqueiem estabilidade nem validação

### 10.1.1 Ciclo de estabilização VFR v1 (2026-06)

Estabilização do fluxo essencial (criar/salvar/reabrir) sem mudança de
comportamento nem de schema. Confirmado que o salvamento depende apenas de
origem + destino — SimBrief, SkyVector, IA e cartas seguem secundários e não
bloqueiam o fluxo. Resultados:

- **Cálculo de combustível/autonomia extraído** para
  `apps/app/src/components/vfr/vfrFuel.ts` (funções puras: `computeFuelPlan`
  para perna/alternado/contingência/reserva/total requerido/por asa/peso de
  decolagem, e `formatEndurance` para `hh:mm`). A aritmética antes embutida em
  `VfrPlanForm.tsx` é a mesma — só virou módulo testável. Cobertura em
  `vfrFuel.spec.ts`.
- **Regras do serviço de planos cobertas** em
  `apps/api/src/flight-plans/flight-plans.service.spec.ts`: propriedade
  (owner/forbidden), exclusão de planos soft-deleted, sugestão de pista em uso
  (§5.2) e desempenho de rota.
- **Chave OpenAIP deixou de ser hardcoded** (resolve o item "segredos/chaves
  não devem ficar hardcoded" abaixo): a camada de espaço aéreo OpenAIP agora é
  opcional e configurada por `EXPO_PUBLIC_OPENAIP_API_KEY`. Sem a chave, o
  toggle some e o restante do mapa continua funcionando.

### 10.2 Integração SkyVector (companion VFR mundial/EUA)

O SkyVector deixou de ser "fora de escopo" (§10) e passou a **companion VFR**
aceito no baseline. Motivação: uma camada de carta seccional dos EUA nativa não
é viável sem tiles proprietários e pagos — então, em vez de hospedar mapa, o FS
Suite interopera com o SkyVector, reconhecido como o melhor planejador VFR dos
EUA (ver `docs/vfr-layer-model.md` §0 sobre a decisão de não hospedar raster).

- **Exportar / abrir no SkyVector:** botão na seção de rota abre a rota montada
  no SkyVector, com velocidade e altitude propagadas no primeiro fixo enroute
  (exige aeronave + nível de cruzeiro definidos). Tail/fuel/ETD não são
  transportáveis via URL.
- **Importar do SkyVector (`.fpl`):** botão na seção de aeródromos importa o
  arquivo Garmin FlightPlan v1 exportado pelo SkyVector; origem/destino são
  resolvidos por `icao`/`gps_code`/`local_code` (com fallback) e os waypoints
  entram na rota. Idents não resolvidos ficam para seleção manual.

Detalhes de contrato e parsing em `docs/technical-spec.md` §9.

### Itens que permanecem sob controle antes de evolução

Os itens abaixo não exigem remoção imediata, mas precisam ser tratados antes de qualquer handoff de qualidade ou nova expansão funcional:

- lint deve voltar a passar em `apps/app` e `apps/api`
- segredos/chaves não devem ficar hardcoded no frontend
- migrations não devem desfazer índices necessários para busca textual
- rotas removidas não devem continuar linkadas na UI
- qualquer integração adicional deve ser documentada antes de virar dependência de produto

### Nova regra de trabalho

A partir deste ponto, a evolução do VFR deve acontecer somente por **micro-specs**.

Cada micro-spec deve conter:

- objetivo funcional pequeno
- escopo explícito
- fora de escopo
- critérios de aceite testáveis
- validação esperada antes de avançar

Nenhuma micro-spec deve tentar cobrir mais de uma entrega funcional perceptível para o usuário.

## 11. Critérios de aceite

A feature só pode ser considerada pronta quando:

- usuário autenticado acessa o fluxo de `Novo Planejamento VFR`
- origem, destino e alternativo podem ser selecionados por texto
- origem, destino e alternativo podem ser selecionados por clique no mapa
- elevação dos aeródromos é carregada corretamente
- METAR dos três aeródromos é exibido
- pista em uso é sugerida quando houver dados suficientes
- pista em uso continua editável manualmente
- usuário consegue preencher rota, referências visuais, nível de cruzeiro e TOD
- usuário consegue preencher os insumos de autonomia
- cálculos de autonomia e abastecimento são exibidos
- usuário consegue marcar os briefings
- usuário consegue salvar e reabrir o planejamento
- a navegação permanece estável, sem rotas fantasmas ou colapso de tela

## 12. Sequenciamento recomendado

Para reduzir risco, a implementação deve ser dividida em duas entregas internas:

### Entrega A

- modelagem de dados
- endpoints de aeródromo
- busca textual
- mapa com seleção
- METAR
- formulário base de rota
- salvamento do planejamento

### Entrega B

- cálculos de autonomia
- checklist de briefings
- refinamento de UX
- validação ponta a ponta

## 13. Questões em aberto para confirmação de negócio

- alternativo será obrigatório ou opcional?
- `PDC` deve permanecer como item manual nesta feature VFR?
- unidade principal de combustível será litros, galões ou configurável por perfil?
- `Compartilhar no Facebook` permanece como checklist manual ou sai da v1?

## 14. Fontes técnicas

- OurAirports data: <https://ourairports.com/data/>
- OurAirports data dictionary: <https://ourairports.com/help/data-dictionary.html>
- MapLibre GL JS: <https://maplibre.org/projects/gl-js/>
- MapLibre docs: <https://maplibre.org/maplibre-gl-js/docs/>
- AviationWeather.gov Data API: <https://aviationweather.gov/data/api/>
- OpenStreetMap tile policy: <https://operations.osmfoundation.org/policies/tiles/>
