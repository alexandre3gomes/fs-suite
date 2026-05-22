# Plano de testes — TPA, perfil único de cruzeiro e TOC/TOD com referências visuais

Ambiente: local em `http://mac.local:8081` (Expo) + API local. Aeronave de teste: qualquer C172/C182 (Cat A ou B).

## Setup

- Backend rodando (`pnpm --filter @fs-suite/api dev`)
- Expo rodando (`pnpm --filter @fs-suite/app dev`)
- Migration aplicada (`destination_tpa_ft`, `destination_tpa_source` em `flight_plans`)
- Aeronave selecionada com `cruiseSpeedKts` definido

---

## 1. TPA padrão por categoria

**Objetivo:** validar que a TPA é calculada automaticamente conforme a categoria de performance.

### 1.1 — Aeronave Cat A (C172, ~110 kt)
1. Criar novo plano VFR
2. Selecionar C172 ou aeronave com cruise speed < ~140 kt → categoria A
3. Selecionar destino **SBJD** (elev 2440 ft)
4. **Esperado:** campo "TPA destino" exibe `3400` ou `3500` (elev + 1000 ft AGL, arredondado a 100 ft)
5. **Esperado:** hint mostra `padrão (Cat A)`

### 1.2 — Aeronave Cat B (Saratoga, Bonanza ~155 kt cruise)
1. Selecionar aeronave Cat B
2. Destino SBJD
3. **Esperado:** TPA `3400/3500` (Cat A/B usam 1000 ft AGL)
4. Hint `padrão (Cat B)`

### 1.3 — Trocar destino preserva fonte
1. Com TPA em modo padrão, trocar destino para SBKP (elev 2170 ft no banco — Viracopos)
2. **Esperado:** TPA recalcula automaticamente para `3200` ft (Cat B: 2170 + 1000 = 3170 → 3200)

---

## 2. TPA editável (override manual)

### 2.1 — Override manual
1. Plano com destino SBJD, TPA padrão = 3500
2. Editar campo TPA para `3800` (valor da VAC Cat A/B)
3. **Esperado:** hint muda para `valor da VAC`
4. **Esperado:** botão "usar padrão" aparece à direita

### 2.2 — Reset
1. Após override (TPA=3800), clicar em "usar padrão"
2. **Esperado:** TPA volta para `3500`, hint para `padrão (Cat A)`

### 2.3 — Persistência (save + reload)
1. Override TPA=3800 → salvar plano
2. Recarregar o plano
3. **Esperado:** TPA volta a `3800` e fonte `custom` (VAC)

### 2.4 — Persistência sem override
1. Plano com TPA padrão → salvar
2. Recarregar
3. **Esperado:** TPA continua padrão; mudar categoria recalcula

---

## 3. Refatoração de altitude de cruzeiro (perfil único)

### 3.1 — Rota com corredor REA propagável (SBMT → SBJD via Penteado)
1. Origem SBMT (elev ~2400), destino SBJD (elev ~2440)
2. Rota seguindo corredor REA Penteado (altitude obrigatória 3600 ft)
3. METAR sem nuvens (ou ceiling > 4600 ft)
4. **Esperado:** todas as pernas mostram `3,600` na coluna Alt
5. **Esperado:** **não** sugere 6500 ft para os trechos livres antes/depois do corredor
6. **Justificativa:** corredor 3600 ft está abaixo de 3000 AGL relativo a origem (origem 2400 + 3000 = 5400, 3600 < 5400) → regra hemisférica não obriga

### 3.2 — Rota com corredor + nuvens baixas
1. Mesma rota anterior
2. METAR com BKN 3000 ft (teto baixo)
3. **Esperado:** o app marca corridor como bloqueado por nuvens (corridor altitude 3600 ft está dentro de 1000 ft da camada BKN)
4. **Esperado:** rota deve ser marcada como inviável VFR (ou warning forte)

### 3.3 — Rota sem corredor (free flight)
1. Rota direta sem REA
2. Altitudes seguem regra hemisférica do rumo médio
3. **Esperado:** mesma altitude em todos os trechos (perfil único do segmento livre)

### 3.4 — Mudança de aeronave/categoria
1. Plano com Cat A → TPA 3500, cruzeiro 3600
2. Trocar para Cat C (turboprop)
3. **Esperado:** TPA recalcula para ~3900 (1500 ft AGL), cruise atualiza se viável

---

## 4. TOD apontando para TPA (não elevação)

### 4.1 — TOD com cruzeiro acima da TPA
1. Plano SBMT → SBJD, cruzeiro = 6500 ft (forçar manual), TPA = 3800 ft, GS ~100 kt
2. Esperado: TOD calculado para chegar nivelado em 3800 ft, não em 2440 ft
3. Cálculo de referência: `(6500-3800)/500 = 5.4 min` de descida; 5.4/60 × 100 = 9 NM + 2 NM buffer = **~11 NM antes do destino**

### 4.2 — TOD com cruzeiro igual à TPA
1. Cruzeiro 3600 ft, TPA 3800 ft (cruzeiro abaixo da TPA — incomum mas válido)
2. **Esperado:** sem TOD (não precisa descer)
3. Em vez disso, mostraria um **climb final** se o app suportasse (não obrigatório nesta fase)

### 4.3 — TOD em rota curta sem espaço
1. Rota muito curta (< 5 NM) com cruzeiro alto
2. **Esperado:** card de TOD não aparece OU aparece com referência adequada

---

## 5. TOC/TOD com referência visual

### 5.1 — TOC em rota normal
1. Plano com cruzeiro 5500 ft, origem SBMT (elev 2400, climb 700 fpm, climb speed 75 kt)
2. Cálculo de referência: `(5500-2400)/700 = 4.43 min × 75/60 = 5.5 NM`
3. **Esperado card de subida:**
   - "Após [origem ou primeiro waypoint], voe X:XX em MH YYY°, então inicie subida"
   - "Razão 700 fpm · 4:26 de subida até 5,500 ft"

### 5.2 — TOD com waypoint anterior
1. Plano SBMT → SBJD, cruzeiro 5500 ft, TPA 3800 ft, GS ~100 kt, taxa descida 500 fpm
2. Descida = `(5500-3800)/500 = 3.4 min × 100/60 = 5.7 NM + 2 buffer = 7.7 NM`
3. Identificar o waypoint anterior ao TOD (provavelmente Estádio ou similar)
4. **Esperado card de descida:**
   - "Após [waypoint], voe X:XX em MH YYY°, então inicie descida"
   - "Razão 500 fpm · 3:24 de descida até TPA 3,800 ft · nivele antes de SBJD"

### 5.3 — Sem aeronave selecionada
1. Plano sem aeronave
2. **Esperado:** cards de TOC/TOD não aparecem (sem dados de performance)

### 5.4 — Sem TPA disponível
1. Destino sem elevação no banco
2. **Esperado:** TPA não calcula, card de TOD não aparece (ou usa fallback)

---

## 6. Tabela de pernas — colunas e formatação

### 6.1 — Estrutura
1. Verificar header: `# | Leg | NM | MH | GS | Alt | ETE | Ref`
2. **Esperado:** headers numéricos centralizados, header `Leg` à esquerda
3. **Esperado:** valores numéricos centralizados

### 6.2 — Altitude por trecho
1. Plano com corredor REA propagável → **todas pernas** mostram 3600 ft
2. Plano sem corredor → **todas** mostram mesma altitude (cruzeiro único)
3. Plano com corredor não-propagável (cloud bloqueia) → free legs mostram cruzeiro maior, corridor legs mostram 3600

### 6.3 — ETE em mm:ss
1. Verificar pernas mostrando `mm:ss` (ex: `4:48` para 4.8 min)
2. Total final em `mm:ss` também

---

## 7. PDF export

### 7.1 — Tabela de navegação
1. Exportar PDF
2. **Esperado:** colunas `# | Leg | NM | MH | GS | Alt | ETE`
3. **Esperado:** ETE em mm:ss em cada perna e total

### 7.2 — Seção Climb & Descent Profile
1. Exportar PDF de plano com TOC/TOD válidos
2. **Esperado:** seção "CLIMB & DESCENT PROFILE" presente
3. **Esperado:** subseção TOC com instruções (After X, fly Y:YY on MH Z°)
4. **Esperado:** subseção TOD com TPA como alvo + próximo waypoint

### 7.3 — PDF sem TOC/TOD
1. Plano onde cruzeiro = elevação (improvável) ou sem aeronave
2. **Esperado:** seção CLIMB & DESCENT PROFILE não aparece

---

## 8. Backend persistence

### 8.1 — Save + reload via API
1. Criar plano com TPA custom = 3800
2. POST `/flight-plans` deve aceitar `destinationTpaFt: 3800` e `destinationTpaSource: 'custom'`
3. GET `/flight-plans/:id` retorna os mesmos valores
4. Editar plano → PATCH retorna ok

### 8.2 — DTO validation
1. Enviar `destinationTpaFt: "abc"` (string) → API deve rejeitar (400)
2. Enviar payload sem TPA → API aceita (campo é opcional)

### 8.3 — AI validation
1. Plano com TPA → POST `/ai-validation/validate`
2. **Esperado:** API aceita o campo (não rejeita por whitelist)
3. **Esperado (opcional):** TPA aparece no prompt enviado à IA

---

## 9. Casos limítrofes

### 9.1 — Origem alta (planalto)
1. Origem SBJM (elev ~2000 ft em outra topografia)
2. Cruzeiro 3600 ft fica abaixo de 3000 AGL → regra hemisférica não aplica
3. **Esperado:** corridor altitude propaga normalmente

### 9.2 — Cruise = TPA = corridor altitude
1. SBMT → SBJD com TPA = 3600 (custom da VAC), corridor 3600, cruise 3600
2. **Esperado:** nenhum TOD (sem necessidade de descer)
3. **Esperado:** tabela mostra 3600 em todas as pernas

### 9.3 — Múltiplos waypoints
1. Rota com 8+ waypoints
2. **Esperado:** TOC/TOD ancoram em waypoints visualmente identificáveis (nome do REA fixo)

---

## 10. UX / Acessibilidade

### 10.1 — Mobile
1. Abrir em viewport estreito (iPad portrait, iPhone)
2. **Esperado:** tabela de pernas com scroll horizontal
3. **Esperado:** cards de TOC/TOD legíveis

### 10.2 — i18n
1. Trocar idioma para EN
2. **Esperado:** labels "Destination TPA", "Climb plan (TOC)", "Descent plan (TOD)" em inglês

---

## Critério de aceite

- [ ] Todos os itens em 1-7 passam visualmente
- [ ] Plano salvo e recarregado mantém TPA (custom + default)
- [ ] Cards de TOC/TOD aparecem com waypoint, tempo e MH corretos
- [ ] PDF exporta com nova seção
- [ ] Sem regressão visível no cálculo de combustível e tempo total
- [ ] Lint, typecheck e Expo dev server compilam sem erro

---

## 11. Camada 1 — UI altitude única

### 11.1 — Rota com corredor REA propagável
1. SBMT → SBJD via corredor REA Penteado (3600 ft obrigatório)
2. METAR sem nuvens
3. **Esperado:** UI mostra **um único seletor** de altitude com o valor 3600 ft destacado
4. **Esperado:** **NÃO** aparece a seção "TRECHO LIVRE / REA / TRECHO LIVRE" com seletores separados
5. **Esperado:** tabela de pernas exibe 3600 em todas as linhas
6. **Esperado:** card de TOC indica subida de SBMT (elev) até 3600 ft

### 11.2 — Rota sem corredor (free flight)
1. Rota direta sem REA
2. **Esperado:** seletor único com altitudes semicirculares do rumo médio
3. Selecionar uma altitude → propaga para todas as pernas

### 11.3 — Mudança de aeronave
1. Plano configurado com Cat A → Trocar para Cat C
2. **Esperado:** TPA atualiza, e seletor de cruzeiro recalcula

---

## 12. Camada 2 — Transições manuais de altitude

### 12.1 — Adicionar transição
1. Rota com waypoints A, B, C, D, dest
2. Na seção "Mudanças de altitude na rota", expandir
3. Selecionar waypoint C, altitude 5500
4. Clicar **Adicionar**
5. **Esperado:** transição aparece na lista com texto "Em C, mude para 5500 ft"

### 12.2 — Tabela de pernas reflete transição
1. Cruzeiro inicial 3600, transição "em C → 5500"
2. **Esperado:** pernas A→B e B→C mostram 3600, pernas C→D e D→dest mostram 5500

### 12.3 — Card de transição em climb/descent plan
1. Após adicionar transição como acima
2. **Esperado:** novo card "Mudança de altitude (subida/descida)"
3. Texto: "Ao cruzar C, inicie a manobra imediatamente"
4. Detalhes: "Razão {X} fpm · MM:SS · 3,600 ft → 5,500 ft"

### 12.4 — Persistência
1. Adicionar transição, salvar plano
2. Recarregar plano
3. **Esperado:** transição persistida e renderizada igual

### 12.5 — Remover transição
1. Lista com 1+ transições
2. Clicar **Excluir** numa transição
3. **Esperado:** removida, tabela e cards atualizados

---

## 13. Camada 3a — Validação semicircular no safety-checker

### 13.1 — Voo Leste a 4500 ft (errado para Cat A/B)
1. Origem SBMT (elev 2400), destino a leste (MC ~090°)
2. Altitude **4500 ft** (acima de 3000 AGL do origem: 2400 + 3000 = 5400 — abaixo do limiar)
3. **Aguarde**: 4500 está abaixo do limiar 5400 → regra hemisférica não aplica → sem violação

### 13.2 — Voo Leste a 7500 ft (correto)
1. MC 090°, altitude 7500 (ímpar+500 ✓)
2. **Esperado:** sem violação semicircular

### 13.3 — Voo Leste a 8500 ft (errado, par+500 sendo Leste)
1. MC 090°, altitude 8500 (par+500, deveria ser ímpar)
2. **Esperado:** item actionable "Perna X (MC 090°): nível 8500 ft viola regra hemisférica — esperado ímpar + 500"

### 13.4 — Altitude redonda (4000 ft)
1. Cruise = 4000 ft (milhar redondo, exclusivo IFR)
2. **Esperado:** item actionable "Nível 4000 ft não é VFR — VFR requer milhares + 500 ft"

---

## 14. Camada 3b — Validação REA no SafetyAssessment

### 14.1 — Altitude correta no corredor
1. SBMT → SBJD via Penteado a 3600 ft (altComp do REA)
2. **Esperado:** sem violação REA

### 14.2 — Altitude diferente da compulsória
1. Mesma rota a 5500 ft
2. **Esperado:** item blocking "REA X → Y: Altitude compulsória neste trecho: 3600ft"
3. Status do assessment: `not-viable`

### 14.3 — Altitude fora do range
1. Rota num corredor REA com range (ex: 4000-6000)
2. Cruzeiro 7500 ft
3. **Esperado:** item blocking "Altitude 7500ft fora dos limites (4000–6000ft)"

---

## 15. Camada 3c — Viabilidade de transição com performance

### 15.1 — Transição viável (curta)
1. Cruzeiro 3600, transição "em B → 4500" (diff 900 ft)
2. Perna B→C tem 8 NM, GS 100 kt
3. Tempo de subida: 900 / 700 fpm = 1.3 min → distância: 2.1 NM
4. **Esperado:** sem alerta (2.1 NM < 8 NM)

### 15.2 — Transição inviável (perna curta)
1. Cruzeiro 3600, transição "em B → 7500" (diff 3900 ft)
2. Perna B→C tem 3 NM, GS 100 kt
3. Tempo: 3900/700 = 5.6 min → 9.3 NM
4. **Esperado:** item actionable "Transição em B (subida 3900 ft): requer 9.3 NM mas a perna seguinte tem 3.0 NM"

---

## Critério de aceite — Camadas 1-3

- [ ] UI mostra apenas um seletor de altitude (sem split por segmento)
- [ ] Adicionar/remover transição funciona; persiste no save
- [ ] Cards intermediários de transição aparecem corretamente
- [ ] Tabela de pernas reflete transições
- [ ] Safety assessment flag para violação semicircular (acima 3000 AGL)
- [ ] Safety assessment blocking para violação REA
- [ ] Safety assessment flag para transição inviável por performance
- [ ] Plano de testes anterior (1-10) ainda passa
