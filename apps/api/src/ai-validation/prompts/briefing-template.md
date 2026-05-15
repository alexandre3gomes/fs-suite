# Briefing VFR — {ORIGIN} → {DESTINATION} | {AIRCRAFT}

Plano analisado: {ORIGIN_NAME} {ORIGIN_ICAO} → {DESTINATION_NAME} {DESTINATION_ICAO}, {AIRCRAFT}, VFR, {DISTANCE} NM, ETE {ETE}, nível planejado {CRUISE_LEVEL}, rota {ROUTE_POINTS}, alternado {ALTERNATE_ICAO}.

---

## 1. Resumo executivo

| Item | Decisão |
|------|---------|
| Aeronave | {AIRCRAFT_NAME} |
| Partida | {ORIGIN_ICAO}, RWY {ORIGIN_RWY} |
| Chegada | {DESTINATION_ICAO}, pista provável {DEST_RWY} |
| Rota | {ROUTE_DESCRIPTION} |
| Altitude inicial | {INITIAL_ALT} ft |
| Altitude de rota | {CRUISE_ALT} ft, se autorizado |
| TOC altitude inicial | {TOC_INITIAL} |
| TOC altitude de rota | {TOC_CRUISE} |
| Alternado | {ALTERNATE_ICAO} |
| Maior ameaça | {THREAT_1} |
| Segunda ameaça | {THREAT_2} |

---

## 2. Meteorologia

### {ORIGIN_ICAO}

METAR do plano:

```
{ORIGIN_METAR}
```

- Vento: {WIND_DIR}°/{WIND_SPEED} kt
- Visibilidade: {VISIBILITY}
- QNH: {QNH}
- Temperatura: {TEMP}°C

### {ALTERNATE_ICAO} alternado

```
{ALTERNATE_METAR}
```

Comentário operacional sobre condições no alternado e adequação.

---

## 3. Melhor pista de decolagem — {ORIGIN_ICAO}

Dados da carta ADC:

- Pista(s): {ORIGIN_RUNWAYS}
- Rumo magnético: {RWY_HDG}°
- Comprimento de pista: {RWY_LENGTH}
- Elevação: {ORIGIN_ELEV} ft
- Frequências: {ORIGIN_FREQUENCIES}

Com vento {WIND_DIR}/{WIND_SPEED}, a RWY {BEST_RWY} tem componente de proa. Calcular: headwind = {WIND_SPEED} × cos({WIND_DIFF}°) = {HEADWIND} kt, crosswind = {WIND_SPEED} × sin({WIND_DIFF}°) = {CROSSWIND} kt.

Decisão: decolagem pela RWY {BEST_RWY}.

---

## 4. Cold and dark — {AIRCRAFT_TYPE}

### Pré-voo

Antes de entrar:

- documentos, plano, meteorologia e NOTAMs;
- combustível visualmente conferido nos tanques;
- óleo: verificar nível;
- drenar combustível;
- checar pneus, freios, superfícies, pitot, estática, antenas, luzes;
- remover calços, amarras e trava de comando.

### Partida do motor

Sequência prática conforme checklist da aeronave:

1. Brakes — SET
2. Fuel selector — conforme manual
3. Mixture — conforme procedimento
4. Master — ON
5. Beacon — ON
6. Partida conforme checklist
7. Após motor estabilizado: oil pressure check
8. Alternator — ON
9. Avionics — ON
10. Mixture — lean para táxi

---

## 5. Combustível — análise

| Item | Valor |
|------|-------|
| Trip fuel | {TRIP_FUEL} |
| Alternado | {ALT_FUEL} |
| Contingência | {CONTINGENCY_FUEL} |
| Reserva {RESERVE_MIN} min | {RESERVE_FUEL} |
| Mínimo requerido | {MIN_FUEL} |
| A bordo | {ON_BOARD_FUEL} |
| Endurance | {ENDURANCE} |

Comentário operacional: avaliar se a margem é suficiente para a complexidade do voo (TMA movimentada, possíveis esperas, arremetidas). Se margem < 15 min além do mínimo, alertar como crítico.

Recomendação prática:

- mínimo confortável: margem de pelo menos 30 min extra;
- motivo: órbitas, espera, troca de pista, arremetida, tráfego, erro de navegação, alternado real.

---

## 6. Táxi em {ORIGIN_ICAO}

### Frequências {ORIGIN_ICAO}

| Serviço | Frequência |
|---------|-----------|
| ATIS | {ATIS_FREQ} |
| Solo | {GND_FREQ} |
| Torre | {TWR_FREQ} |

### Chamada inicial

"{ORIGIN_NAME} Solo, {CALLSIGN}, {AIRCRAFT_TYPE} no pátio, VFR para {DESTINATION_NAME} via {FIRST_WAYPOINT}, informação {INFO_LETTER} recebida, QNH {QNH}, solicita acionamento e táxi."

### Táxi provável

Lógica de táxi com base na carta ADC: descrever rota provável do pátio ao ponto de espera.

---

## 7. Run-up e briefing de decolagem

### Run-up

- Brakes — SET
- Flight controls — FREE AND CORRECT
- Fuel selector — conforme manual
- Trim — TAKEOFF
- Flaps — conforme procedimento de decolagem
- Mixture — BEST POWER
- Throttle — RPM de cheque
- Magnetos — check
- Instrumentos — check
- GPS/FPL — rota ativa
- Heading bug — {RWY_HDG}°
- Transponder — ALT

### Velocidades

| Velocidade | Valor |
|-----------|-------|
| Vr | {VR} kt |
| Vy | {VY} kt |
| Vx | {VX} kt |
| Best glide | {BEST_GLIDE} kt |
| Aproximação | {VAPP} kt |

### Briefing de decolagem

"Decolagem {TAKEOFF_TYPE} RWY {BEST_RWY}, flaps {FLAP_SETTING}, rotação {VR} kt, subida Vy {VY} kt. Pane antes da rotação: potência idle, freios, manter na pista. Pane após decolagem sem altitude: pouso à frente, pequenas correções. Acima de altitude segura: avaliar retorno somente se houver altura e posição."

---

## 8. Saída visual de {ORIGIN_ICAO} — RWY {BEST_RWY}

Descrever o procedimento de saída conforme a VAC do aeródromo:

- Altitude compulsória no circuito
- Quando curvar e para que direção
- Referências visuais na saída
- Como integrar na rota planejada

Sequência operacional:

1. Decolar RWY {BEST_RWY}.
2. Manter eixo da pista.
3. Cumprir saída visual publicada conforme altitude.
4. Prosseguir para primeiro waypoint.
5. Subir para altitude inicial.
6. Referências visuais relevantes na saída.

---

## 9. Navegação em rota

### Navigation log

| Leg | Distância | TC | MC | Altitude planejada |
|-----|-----------|-----|-----|-------------------|
| {LEG_DATA} |

### Perfil recomendado

| Fase | Altitude |
|------|----------|
| Saída {ORIGIN_ICAO} | {INITIAL_ALT} ft |
| Cruzeiro | {CRUISE_ALT} ft |
| Descida | conforme ATC/VAC destino |

### TOC

Estimativa de TOC com base no peso de decolagem, razão de subida realista e ganho de altitude necessário.

---

## 10. Ameaças em rota

### 1. {THREAT_1_TITLE}

Descrição detalhada da ameaça com dados concretos.

Mitigação:
- ações específicas para este voo

### 2. {THREAT_2_TITLE}

Descrição detalhada da ameaça com dados concretos.

Mitigação:
- ações específicas para este voo

### 3. Espaço aéreo

Descrever CTRs, TMAs e setores que a rota atravessa. Tráfego esperado.

Mitigação:
- VAC e REA abertas;
- altitudes publicadas;
- fraseologia curta;
- transponder ALT.

### 4. Carga de trabalho

Avaliar se o tempo de voo é curto demais para a complexidade da rota.

---

## 11. Frequências importantes

### {ORIGIN_ICAO}

| Serviço | Frequência |
|---------|-----------|
| {ORIGIN_FREQ_TABLE} |

### {DESTINATION_ICAO}

| Serviço | Frequência |
|---------|-----------|
| {DEST_FREQ_TABLE} |

---

## 12. Chegada em {DESTINATION_ICAO}

### Melhor pista para pouso

Análise de vento para determinar pista mais adequada. Calcular componentes de vento.

Dados da VAC:
- Pista(s)
- Elevação
- Altitudes de circuito por categoria

### Entrada provável

Descrever de que setor a rota chega e como integrar no circuito.

### Chamada

"{DESTINATION_NAME} Torre, {CALLSIGN}, {AIRCRAFT_TYPE}, procedente de {ORIGIN_NAME} via {LAST_WAYPOINT}, {ALTITUDE} pés, VFR para pouso."

---

## 13. Circuito de tráfego {DESTINATION_ICAO} — RWY {DEST_RWY}

### Configuração

- Reduzir velocidade antes de ingressar.
- Mistura — rich/enriquecida.
- Fuel selector — conforme manual.
- Landing light — ON.
- Flaps — conforme velocidades limites.

### Perfil sugerido

| Posição | Configuração |
|---------|-------------|
| Ingresso no circuito | {CIRCUIT_ALT} ft, 90 kt |
| Través da cabeceira | potência reduzida, flap 10 |
| Base | 75 kt, flap 20 |
| Final | {VAPP} kt, flap full |
| Curta final | estabilizado |

### Fraseologia

"{CALLSIGN}, perna do vento pista {DEST_RWY}."

"{CALLSIGN}, base pista {DEST_RWY}."

"{CALLSIGN}, final pista {DEST_RWY}, toque completo."

---

## 14. Pouso e livramento

Após pouso:

1. manter eixo;
2. reduzir velocidade;
3. livrar pela taxiway instruída;
4. cruzar a linha de espera;
5. parar se necessário;
6. flaps UP;
7. transponder GND/STBY;
8. mixture lean;
9. chamar Solo.

Chamada:

"{DESTINATION_NAME} Solo, {CALLSIGN} livrou a pista {DEST_RWY}, solicita táxi para o pátio."

---

## 15. Alternado {ALTERNATE_ICAO}

Dados do alternado:
- Pista(s), elevação, comprimento
- Frequências (TWR, Solo, ATIS)

Avaliar adequação do alternado:
- infraestrutura vs. complexidade operacional;
- distância e combustível necessário;
- tráfego esperado;
- se combustível é justo, decisão de desvio precisa ser tomada cedo.

---

## 16. Briefing final pronto para voar

Resumo de 4-6 linhas cobrindo: rota, pista, vento, altitudes, principais ameaças, chegada, frequências-chave e recomendação final do instrutor.
