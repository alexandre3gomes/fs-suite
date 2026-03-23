# FS Suite - Especificacao Inicial

## 1. Visao do Produto
FS Suite sera uma plataforma digital focada em simulacao de voo, com inicio como aplicacao web e arquitetura preparada para expansao para apps iPhone e Android.

A plataforma unificara, em uma experiencia com branding do canal Simulando, os fluxos mais importantes do piloto virtual:
- planejamento de voo
- acompanhamento de voo
- consulta operacional
- integracoes com ferramentas ja consolidadas do ecossistema
- futuramente, recursos sociais, briefing e analytics de voos

O primeiro modulo a ser entregue sera o de planejamento de voo.

## 2. Objetivos do Projeto
### Objetivos de negocio
- consolidar a marca Simulando em um produto digital proprietario
- criar uma base de usuarios autenticados para relacionamento recorrente
- centralizar ferramentas hoje dispersas em multiplos sites
- abrir caminho para monetizacao futura com plano premium, recursos exclusivos e integracoes avancadas

### Objetivos de produto
- reduzir o tempo necessario para planejar um voo completo
- oferecer uma experiencia visual mais clara que as ferramentas isoladas
- permitir que o usuario concentre briefing, rota, combustivel, cartas e acompanhamento em um unico dashboard
- entregar uma base tecnica reutilizavel para web e mobile

## 3. Perfil de Usuario
### Persona principal
Piloto virtual que utiliza simuladores como Microsoft Flight Simulator, X-Plane e Prepar3D e precisa planejar voos VFR e IFR com eficiencia.

### Segmentos iniciais
- entusiasta casual que quer um fluxo simples de planejamento
- piloto virtual intermediario que usa SimBrief, SkyVector e FlightAware
- criador de conteudo ou membro da comunidade Simulando que busca uma experiencia mais integrada

## 4. Escopo do MVP
O MVP deve ser focado em autenticacao, identidade da marca e no primeiro fluxo completo de planejamento de voo.

### Incluido no MVP
- landing/dashboard autenticado com branding Simulando
- login com Google OAuth
- perfil basico do usuario
- modulo de planejamento de voo
- integracao inicial com SimBrief
- integracao por link/contexto com SkyVector
- consulta de dados de voo e aeroportos necessarios para o planejamento
- historico basico de planejamentos
- arquitetura preparada para expansao mobile

### Fora do MVP
- rede social ou comunidade interna
- marketplace
- multiplayer em tempo real
- monetizacao e assinatura
- editor avancado de cartas
- tracking em tempo real completo
- notificacoes push
- suporte offline completo

## 5. Problema que o MVP Resolve
Hoje o usuario alterna entre multiplas ferramentas para montar um voo: uma para gerar OFP, outra para visualizar rota, outra para consultar tracking, meteorologia e informacoes dos aeroportos. Isso gera friccao, perda de contexto e experiencia fragmentada.

O MVP deve resolver isso concentrando a etapa de planejamento em uma interface unica, com automacoes e atalhos para as ferramentas externas mais relevantes.

## 6. Proposta de Valor
"Planeje seu voo virtual em um unico lugar, com a identidade Simulando, integrando as melhores ferramentas do ecossistema sem perder contexto operacional."

## 7. Requisitos Funcionais
### 7.1 Autenticacao
- permitir login com Google OAuth
- criar conta do usuario no primeiro acesso
- manter sessao autenticada com refresh seguro
- permitir logout

### 7.2 Perfil do usuario
- armazenar nome, email, avatar e provider
- permitir preferencias basicas futuras, como simulador preferido, unidade de combustivel e aeronave favorita

### 7.3 Dashboard inicial
- exibir visao geral do usuario autenticado
- apresentar cards para os modulos principais
- destacar o modulo Planejamento de Voo como entrada principal
- mostrar historico recente de planejamentos
- reservar espaco para proximas areas: tracking, briefing, tools, favoritos

### 7.4 Planejamento de voo
O modulo inicial deve permitir:
- informar origem e destino
- buscar aeroportos por ICAO ou nome
- selecionar tipo de voo: VFR ou IFR
- selecionar aeronave ou perfil de aeronave
- escolher altitude planejada
- incluir rota manual ou importada
- solicitar geracao/importacao de plano via SimBrief quando aplicavel
- exibir resumo do voo planejado
- abrir rota ou contexto geografico no SkyVector
- salvar planejamento no historico do usuario

### 7.5 Historico
- listar planejamentos anteriores
- permitir reabrir um planejamento salvo
- permitir duplicar planejamento como base para novo voo

### 7.6 Integracoes externas iniciais
- SimBrief: importar ou gerar dados de planejamento conforme API e politicas disponiveis
- SkyVector: abrir visualizacao contextual da rota e dos aeroportos
- FlightAware: previsto para fase seguinte, com consulta de tracking e referencia operacional

## 8. Requisitos Nao Funcionais
- interface responsiva para desktop e tablet desde o inicio
- experiencia mobile-friendly na web, sem depender do app nativo no MVP
- arquitetura compartilhavel entre web e mobile
- boa performance nas telas principais
- observabilidade basica de erros e eventos
- seguranca para dados e segredos de integracao
- LGPD considerada desde a modelagem inicial
- internacionalizacao prevista, com idioma inicial em portugues brasileiro

## 9. Direcao de Branding e UX
### Identidade
- o produto deve refletir claramente o branding do canal Simulando
- tom visual: aviacao, tecnologia, cockpit, navegacao, precisao e confianca
- evitar aparencia generica de dashboard SaaS sem identidade

### Diretrizes iniciais de interface
- dashboard com linguagem visual inspirada em paineis de navegacao e briefing
- destaque para mapas, cards operacionais, dados de rota e status
- suporte a dark theme como opcao futura, mas nao como premissa unica
- componentes reutilizaveis e consistentes para futura expansao mobile

## 10. Stack Tecnologico Recomendado
A escolha precisa equilibrar web-first, reaproveitamento para mobile e boa capacidade de integracao com APIs externas.

### Recomendacao principal
- monorepo com Turborepo
- TypeScript em toda a stack
- `apps/web`: Next.js
- `apps/mobile`: Expo React Native
- `apps/api`: NestJS
- `packages/ui`: design system compartilhado
- `packages/types`: tipos e contratos compartilhados
- `packages/config`: configs compartilhadas
- PostgreSQL como banco principal
- Prisma como ORM
- Redis para cache e filas leves
- fila de jobs para sincronizacoes e integracoes futuras
- autenticacao com Google OAuth via backend proprio

### Justificativa da escolha
- Next.js entrega excelente base para dashboard web, SEO institucional e autenticacao
- Expo acelera entrada futura em iOS e Android com boa ergonomia para time pequeno
- NestJS separa a camada de integracao e regras de negocio das interfaces cliente
- monorepo facilita compartilhamento de contratos, validacoes e componentes
- TypeScript reduz atrito entre web, mobile e backend

### Alternativas consideradas
- Supabase como backend principal: aceleraria o inicio, mas pode limitar parte da orquestracao e integracoes mais especificas
- Firebase: forte para auth e mobile, menos aderente para modelagem relacional e integracoes operacionais mais densas
- React Native sem Expo: maior controle, menor velocidade inicial

## 11. Arquitetura Logica
### Frontend web
- autenticacao
- dashboard
- modulo de planejamento
- historico do usuario
- estado de UI e formularios

### Backend API
- identidade do usuario
- gerenciamento de sessoes
- catalogo de aeroportos e dados operacionais
- servico de planejamento
- adaptadores para SimBrief, SkyVector e futuras integracoes
- logs, auditoria e observabilidade

### Banco de dados
Entidades iniciais previstas:
- User
- OAuthAccount
- Session
- AircraftProfile
- FlightPlan
- FlightPlanRoute
- Airport
- IntegrationConnection
- ActivityLog

## 12. Fluxo Principal do MVP
### Fluxo 1: primeiro acesso
1. usuario acessa a plataforma
2. faz login com Google
3. conta e perfil sao criados
4. usuario entra no dashboard
5. destaque leva ao modulo de planejamento

### Fluxo 2: criar planejamento
1. usuario informa origem e destino
2. sistema sugere aeroportos e dados basicos
3. usuario escolhe tipo de voo, aeronave e parametros
4. sistema integra ou prepara dados para SimBrief
5. sistema apresenta resumo do voo
6. usuario abre contexto no SkyVector se desejar
7. planejamento e salvo no historico

## 13. Roadmap de Fases
### Fase 0 - Fundacao
- monorepo
- identidade visual base
- auth Google
- estrutura de dashboard
- banco de dados e modelos iniciais

### Fase 1 - Planejamento de voo
- formulario completo de planejamento
- cadastro e historico de planos
- integracao inicial com SimBrief
- links/contexto com SkyVector
- resumo operacional do voo

### Fase 2 - Tracking e operacao
- integracao com FlightAware
- status de voo
- cards operacionais ao vivo
- acompanhamento pos-planejamento

### Fase 3 - Ecossistema Simulando
- recursos premium
- preferencias avancadas
- biblioteca de aeronaves e perfis
- briefing expandido
- recursos mobile nativos

## 14. Riscos e Dependencias
- dependencias das politicas e limites das APIs externas
- necessidade de validar juridicamente uso de marcas e dados de terceiros
- qualidade e disponibilidade de dados de aeroportos, rotas e meteorologia
- definicao mais precisa do branding do canal Simulando para sistema visual
- complexidade de tracking em tempo real pode exigir arquitetura adicional

## 15. Metricas Iniciais de Sucesso
- usuarios autenticados
- percentual de usuarios que concluem um planejamento
- tempo medio para criar um plano
- numero de planejamentos por usuario
- taxa de retorno ao dashboard
- uso de integracoes externas por fluxo

## 16. Backlog Inicial Recomendado
### Produto
- definir nome final publico do produto
- consolidar guia visual do branding Simulando
- priorizar dados obrigatorios no formulario de planejamento
- validar escopo exato da integracao com SimBrief

### Engenharia
- iniciar monorepo com web, api e base mobile
- configurar auth Google
- modelar banco inicial
- criar design system inicial
- implementar dashboard base
- implementar CRUD de FlightPlan
- criar adaptador de integracoes

## 17. Decisoes Tomadas Nesta Especificacao
- produto sera web-first com preparacao real para mobile
- stack recomendada: Next.js + Expo + NestJS + PostgreSQL + Prisma + Turborepo
- MVP focado em login, dashboard e planejamento de voo
- SimBrief e SkyVector entram no primeiro modulo; FlightAware fica para a fase seguinte

### Adendo de stack - 2026-03-23
Por decisao de produto posterior a esta versao inicial, a recomendacao de stack das secoes 10 e 17 fica parcialmente substituida para atender ao requisito de manter um unico codebase frontend entre web e mobile e antecipar a prontidao mobile nativa.

Atualizacao:
- `apps/web` (Next.js) e `apps/mobile` (Expo React Native) sao substituidos por `apps/app` com Expo Router
- o novo app deve atender Web, iOS e Android a partir do mesmo codebase TypeScript
- `apps/api` (NestJS), `packages/types`, `packages/config`, PostgreSQL, Prisma, Redis e Turborepo permanecem como decisoes vigentes

Essa mudanca nao altera as prioridades do MVP, que continuam sendo autenticacao, dashboard e planejamento de voo.

## 18. Proximos Artefatos Recomendados
Depois desta especificacao macro, os proximos documentos ideais sao:
- PRD detalhado do modulo de planejamento de voo
- mapa de jornadas do usuario
- modelagem inicial do banco de dados
- arquitetura tecnica do monorepo
- wireframes do dashboard e da tela de planejamento
