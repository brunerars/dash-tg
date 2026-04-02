# Requirements: Dashboard TG — Melhorias v2

**Defined:** 2026-04-02
**Core Value:** O usuario sobe as planilhas e ja encontra todos os resultados computados — sem espera, sem cliques extras.

## v1 Requirements

### Filtros

- [ ] **FILT-01**: API retorna todos os dados sem aplicar min_jogos
- [ ] **FILT-02**: API retorna todos os dados sem aplicar min_green_pct
- [ ] **FILT-03**: Cache existente e invalidado no deploy (dados antigos tem shape filtrada)

### Autenticacao

- [ ] **AUTH-01**: Usuario pode fazer login com username + senha via `POST /auth/login`
- [ ] **AUTH-02**: Endpoints protegidos rejeitam requests sem token valido
- [ ] **AUTH-03**: Usuario pode fazer logout via `POST /auth/logout`
- [ ] **AUTH-04**: Senha armazenada como hash bcrypt em variavel de ambiente
- [ ] **AUTH-05**: CORS restrito ao dominio do frontend (antes de habilitar cookie auth)

### Pre-computacao

- [ ] **PREC-01**: Upload de N planilhas dispara automaticamente todas as 2^N-1 combinacoes para Over/Under
- [ ] **PREC-02**: Endpoint retorna 202 Accepted com job IDs imediatamente
- [ ] **PREC-03**: Resultados de cada combinacao salvos no Redis conforme ficam prontos
- [ ] **PREC-04**: GET /jobs/{job_id} retorna status (pending/running/completed/failed) + cache_key
- [ ] **PREC-05**: Pipeline roda em thread/process pool sem bloquear o event loop
- [ ] **PREC-06**: Jobs expiram do Redis com TTL

## v2 Requirements

### Pre-computacao Avancada

- **PREC-V2-01**: Bulk job status endpoint (GET /jobs/status?ids=id1,id2)
- **PREC-V2-02**: Upload response inclui labels das combinacoes com cache_keys pre-computados

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
| Frontend | Este milestone e so backend/API |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILT-01 | Pending | Pending |
| FILT-02 | Pending | Pending |
| FILT-03 | Pending | Pending |
| AUTH-01 | Pending | Pending |
| AUTH-02 | Pending | Pending |
| AUTH-03 | Pending | Pending |
| AUTH-04 | Pending | Pending |
| AUTH-05 | Pending | Pending |
| PREC-01 | Pending | Pending |
| PREC-02 | Pending | Pending |
| PREC-03 | Pending | Pending |
| PREC-04 | Pending | Pending |
| PREC-05 | Pending | Pending |
| PREC-06 | Pending | Pending |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 0
- Unmapped: 14

---
*Requirements defined: 2026-04-02*
*Last updated: 2026-04-02 after initial definition*
