# Requirements: Dashboard TG

**Defined:** 2026-04-02
**Core Value:** O usuario sobe as planilhas e ja encontra todos os resultados computados — sem espera, sem cliques extras.

## v1 Requirements (Milestone v1.0 — Backend)

### Filtros

- [x] **FILT-01**: API retorna todos os dados sem aplicar min_jogos
- [x] **FILT-02**: API retorna todos os dados sem aplicar min_green_pct
- [x] **FILT-03**: Cache existente e invalidado no deploy (dados antigos tem shape filtrada)

### Autenticacao

- [x] **AUTH-01**: Usuario pode fazer login com username + senha via `POST /auth/login`
- [x] **AUTH-02**: Endpoints protegidos rejeitam requests sem token valido
- [x] **AUTH-03**: Usuario pode fazer logout via `POST /auth/logout`
- [x] **AUTH-04**: Senha armazenada como hash argon2 em variavel de ambiente
- [x] **AUTH-05**: CORS restrito ao dominio do frontend (antes de habilitar cookie auth)

### Pre-computacao

- [x] **PREC-01**: Upload de N planilhas dispara automaticamente todas as 2^N-1 combinacoes para Over/Under
- [x] **PREC-02**: Endpoint retorna 202 Accepted com job IDs imediatamente
- [x] **PREC-03**: Resultados de cada combinacao salvos no Redis conforme ficam prontos
- [x] **PREC-04**: GET /jobs/{job_id} retorna status (pending/running/completed/failed) + cache_key
- [x] **PREC-05**: Pipeline roda em thread/process pool sem bloquear o event loop
- [x] **PREC-06**: Jobs expiram do Redis com TTL

## v2 Requirements (Milestone v2.0 — Frontend Integration)

### Auth Frontend

- [ ] **AUTH-FE-01**: Usuario pode fazer login com username + senha via pagina de login que chama POST /auth/login
- [ ] **AUTH-FE-02**: Qualquer resposta 401 da API redireciona o usuario para /login
- [ ] **AUTH-FE-03**: Usuario pode fazer logout via botao no layout que chama POST /auth/logout e redireciona para /login

### API Migration

- [ ] **API-MIG-01**: Todas as chamadas fetch usam credentials: "include" em vez de header X-API-Key
- [ ] **API-MIG-02**: VITE_API_KEY removido de env vars, Dockerfile build args, e vite-env.d.ts

### Pre-compute Frontend

- [ ] **PREC-FE-01**: Upload de arquivos na pagina Over/Under dispara automaticamente POST /precompute
- [ ] **PREC-FE-02**: UI mostra progresso de polling para cada job de combinacao (status + barra de progresso)
- [ ] **PREC-FE-03**: Quando todos os jobs completam, resultados carregam automaticamente do cache sem clicar Analyze

## Future Requirements

### Pre-computacao Avancada

- **PREC-V2-01**: Bulk job status endpoint (GET /jobs/status?ids=id1,id2)
- **PREC-V2-02**: Upload response inclui labels das combinacoes com cache_keys pre-computados

### Auth UX

- **AUTH-FE-V2-01**: Loading state durante probe de auth (sem flash para login ao dar refresh)
- **AUTH-FE-V2-02**: Toast de sessao expirada

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user / auto-cadastro | Cliente unico, nao precisa |
| Pre-computacao para DALE (eSoccer — Dupla) | So Over/Under tem problema de performance |
| OAuth / login social | Desnecessario para usuario unico |
| Celery / RabbitMQ | Overkill — manter stack simples com Redis |
| WebSocket para job updates | Polling suficiente para 7 jobs |
| Refresh tokens | Single-user, login novamente quando expirar |
| Password reset / recovery | Operador muda .env diretamente |
| Backend changes | Milestone v1.0 entregou todas as APIs |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILT-01 | Phase 1 (v1.0) | Complete |
| FILT-02 | Phase 1 (v1.0) | Complete |
| FILT-03 | Phase 1 (v1.0) | Complete |
| AUTH-01 | Phase 2 (v1.0) | Complete |
| AUTH-02 | Phase 2 (v1.0) | Complete |
| AUTH-03 | Phase 2 (v1.0) | Complete |
| AUTH-04 | Phase 2 (v1.0) | Complete |
| AUTH-05 | Phase 2 (v1.0) | Complete |
| PREC-01 | Phase 3 (v1.0) | Complete |
| PREC-02 | Phase 3 (v1.0) | Complete |
| PREC-03 | Phase 3 (v1.0) | Complete |
| PREC-04 | Phase 3 (v1.0) | Complete |
| PREC-05 | Phase 3 (v1.0) | Complete |
| PREC-06 | Phase 3 (v1.0) | Complete |
| AUTH-FE-01 | TBD | Pending |
| AUTH-FE-02 | TBD | Pending |
| AUTH-FE-03 | TBD | Pending |
| API-MIG-01 | TBD | Pending |
| API-MIG-02 | TBD | Pending |
| PREC-FE-01 | TBD | Pending |
| PREC-FE-02 | TBD | Pending |
| PREC-FE-03 | TBD | Pending |

**Coverage:**
- v1 requirements: 14 total — all complete
- v2 requirements: 8 total
- Mapped to phases: 0
- Unmapped: 8

---
*Requirements defined: 2026-04-02*
*Last updated: 2026-04-02 — Milestone v2.0*
