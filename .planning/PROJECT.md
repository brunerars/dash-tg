# Dashboard TG — Melhorias v2

## What This Is

API backend (FastAPI + Redis) para dashboard de analise eSoccer multi-estrategia. Consome planilhas `.xlsx` de diferentes casas de apostas, processa metricas (deduplicacao, normalizacao, sistema red, SRPT) e serve resultados via HTTP. O frontend consome a API hospedada na VPS.

Este milestone foca em 3 melhorias: pre-computacao assincrona de combinacoes de planilhas para Over/Under, remocao de filtros fixos do backend, e adicao de autenticacao por login/senha.

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

- [x] Pre-computacao assincrona de todas as combinacoes de planilhas para Over/Under — Validated in Phase 3: Async Pre-computation
- [x] Remover filtros min_jogos e min_green_pct do backend — Validated in Phase 1: Backend Filter Removal
- [x] Autenticacao por login/senha (usuario unico) — Validated in Phase 2: JWT Authentication

### Out of Scope

- Multi-user / auto-cadastro — cliente unico, nao precisa
- Pre-computacao para estrategia DALE (eSoccer — Dupla) — so Over/Under precisa de otimizacao
- OAuth / login social — desnecessario para usuario unico
- Frontend — este milestone e so backend/API

## Context

- Projeto brownfield com codebase funcional em producao
- Bases Over/Under tem ~150k linhas — performance e o motivador da pre-computacao
- Quando o usuario sobe 3 planilhas (A, B, C), o sistema precisa rodar todas as combinacoes: A, B, C, A+B, A+C, B+C, A+B+C = 7 combinacoes, cada uma para a estrategia Over/Under
- Cada planilha representa uma casa de apostas diferente
- Hoje o usuario precisa clicar para rodar cada analise manualmente
- Filtros min_jogos e min_green_pct sao aplicados no backend mas devem migrar para o frontend
- Auth atual e por API Key no header — precisa virar login/senha com sessao

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
*Last updated: 2026-04-02 after Phase 3 completion*
