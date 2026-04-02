# Dashboard TG — Frontend Integration v2

## What This Is

Dashboard de analise eSoccer multi-estrategia. Backend FastAPI + Redis consome planilhas `.xlsx`, processa metricas e serve via HTTP. Frontend React + Vite + shadcn/ui consome a API hospedada na VPS.

Milestone v1.0 entregou 3 melhorias backend: remocao de filtros, JWT auth, e pre-computacao async. Este milestone (v2.0) integra o frontend com essas melhorias.

## Core Value

O usuario sobe as planilhas e ja encontra todos os resultados computados — sem espera, sem cliques extras.

## Requirements

### Validated

- ✓ Pipeline de analise completo (load → normalize → deduplicate → metrics → filter) — existing
- ✓ Duas estrategias: eSoccer — Dupla e Over/HT — Dupla + Linha — existing
- ✓ Cache Redis com TTL (analise 24h, export 1h) — existing
- ✓ Cache individual por arquivo (filedf:{md5}) — existing
- ✓ Deduplicacao por cluster ≤ 5 min entre arquivos diferentes — existing
- ✓ Normalizacao de duplas (ordem alfabetica, sufixos) — existing
- ✓ 17 metricas calculadas por grupo (SRPT, sistema red, etc.) — existing
- ✓ Export .xlsx por cache_key — existing
- ✓ Blueprint endpoint para dados brutos — existing
- ✓ Autenticacao por JWT (login/senha, HttpOnly cookie) — replaced API Key in Phase 2
- ✓ Filtros opcionais: data, horario — existing
- ✓ Filtro por nome de planilha (fontes) — existing
- ✓ Docker Compose (api + redis) — existing

### Active

- [ ] Tela de login com username/senha (JWT cookie auth)
- [ ] Migrar API client de X-API-Key para cookies JWT (credentials: "include")
- [ ] Protecao de rotas — redirect para /login em 401 Unauthorized
- [ ] Integracao pre-compute na tela Over/Under (POST /precompute + polling GET /jobs)

### Out of Scope

- Multi-user / auto-cadastro — cliente unico, nao precisa
- Pre-computacao para estrategia DALE (eSoccer — Dupla) — so Over/Under precisa de otimizacao
- OAuth / login social — desnecessario para usuario unico
- Backend changes — milestone v1.0 entregou todas as APIs necessarias

## Current Milestone: v2.0 Frontend Integration

**Goal:** Integrar o frontend React com as 3 melhorias do backend (JWT auth, filtros client-side, pre-computacao async)

**Target features:**
- Tela de login com username/senha (POST /auth/login, cookie JWT)
- Migrar API client de X-API-Key para cookies JWT (credentials: "include")
- Protecao de rotas — redirect para /login em 401
- Integracao pre-compute na tela Over/Under (POST /precompute + polling GET /jobs)

## Context

- Projeto brownfield com codebase funcional em producao
- Backend entrega JWT auth (HttpOnly cookie + Bearer header), pre-compute async, e dados sem filtro
- Frontend React 18 + Vite 6 + Tailwind + shadcn/ui + react-router v7
- API client atual usa fetch() com header X-API-Key — precisa migrar pra cookie JWT
- CORS ja esta lockado a FRONTEND_ORIGIN com allow_credentials=true
- Pre-compute gera 2^N-1 combinacoes para Over/Under — frontend precisa polling de status

## Constraints

- **Stack**: FastAPI + Redis — manter stack existente, sem banco de dados adicional
- **Deploy**: Docker Compose na VPS — manter infraestrutura atual
- **Compatibilidade**: Frontend existente consome a API — mudancas devem ser retrocompativeis ou coordenadas
- **Performance**: Combinacoes Over/Under devem rodar em background sem bloquear o upload

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pre-computacao apenas para Over/Under | DALE nao tem problema de performance | ✓ Phase 3 |
| Filtros min_jogos/min_green_pct saem do backend | Controle deve ser do usuario no frontend | ✓ Phase 1 |
| Auth por login unico (sem multi-user) | Cliente unico, simplicidade | ✓ Phase 2 |
| Manter Redis como unico store | Evitar complexidade de banco adicional | ✓ Phase 3 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-02 — Milestone v2.0 started*
