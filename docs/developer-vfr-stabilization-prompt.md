# Prompt: FS Suite VFR v1 Stabilization

Use this prompt with a developer/agent working in this repository.

```text
Você está trabalhando no repositório FS Suite em:

/Users/alexandre/desenv/projects/personal/fs-suite

Contexto obrigatório:

- Leia primeiro `AGENTS.md`.
- Use `docs/project-spec.md` como fonte de verdade de produto.
- Use `docs/technical-spec.md` como fonte técnica.
- Use `docs/vfr-flight-planning-spec.md` como fonte de escopo funcional da v1 VFR.
- Use `docs/vfr-v1-stabilization-plan.md` como plano de execução e prioridades.

Objetivo:

Estabilizar a primeira entrega utilizável do Planejamento de Voo VFR no FS Suite.
O foco não é adicionar features novas. O foco é tornar o fluxo VFR essencial
confiável, claro, testável e alinhado com a especificação v1.

Prioridades, nesta ordem:

1. Congelar e clarificar o escopo v1 VFR.
   - O usuário deve conseguir criar, salvar e reabrir um planejamento VFR sem
     depender de SimBrief, SkyVector, IA, cartas automáticas, tracking ou
     automações futuras.
   - Recursos avançados existentes podem permanecer, mas devem ser secundários
     e não podem bloquear o fluxo essencial.

2. Reduzir a complexidade de `apps/app/src/components/vfr/VfrPlanForm.tsx`.
   - Faça refactors incrementais, sem reescrever tudo.
   - Extraia primeiro lógica pura e helpers de mapeamento.
   - Depois extraia painéis de UI quando isso reduzir acoplamento real.
   - Não altere schema Prisma sem necessidade clara e documentada.

3. Adicionar testes para o fluxo essencial.
   - Cubra cálculo de combustível, reserva, contingência, quantidade por asa e
     autonomia.
   - Cubra mapeamento create/edit/reopen do plano VFR.
   - Cubra regras importantes do serviço de planos quando tocar API.
   - Use Vitest para lógica pura e testes e2e apenas quando o setup local
     estiver apropriado.

4. Corrigir higiene de configuração/segredos.
   - Revise chaves hardcoded, especialmente OpenAIP em
     `apps/app/src/components/vfr/AerodromeMap.tsx`.
   - Use `EXPO_PUBLIC_*` para configuração pública de frontend.
   - Atualize `.env.example` quando introduzir variável nova.
   - A falta de uma chave opcional não deve quebrar a v1 VFR.

5. Manter documentação alinhada.
   - Atualize docs quando criar nova estrutura, helper ou decisão técnica.
   - Não faça README prometer comportamento que ainda não está estável.
   - Preserve pt-BR para texto de interface.

Restrições:

- Não expandir escopo para premium, social, multiplayer, FlightAware, tracking
  completo, IA nova ou mobile-only.
- Não reverter alterações locais de outros autores.
- Preferir TypeScript, Zod, contratos compartilhados e componentes de
  `packages/ui`.
- Preservar separação entre `apps/app`, `apps/api`, `packages/ui`,
  `packages/types` e `packages/config`.
- Manter arquitetura web-first reutilizável em mobile.

Validação mínima antes de finalizar:

- Rode a validação mais específica da área alterada.
- Antes do handoff final, rode quando viável:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

Resultado esperado:

Entregue mudanças pequenas, revisáveis e orientadas ao fluxo VFR essencial.
No resumo final, informe:

- O que mudou.
- Quais arquivos principais foram tocados.
- Quais validações foram executadas.
- Quais riscos ou pendências permanecem.
```
