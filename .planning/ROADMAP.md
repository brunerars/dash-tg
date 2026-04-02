# Roadmap: Dashboard TG — Melhorias v2

## Overview

Three self-contained backend improvements delivered in risk order: filter removal (pure deletion, no new code), JWT authentication (replaces X-API-Key, isolated to one router and one middleware file), and async pre-computation (most complex, depends on the two preceding phases being stable). Each phase has a clean delivery boundary and unblocks the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Backend Filter Removal** - Remove min_jogos and min_green_pct from API response pipeline; frontend takes ownership of filtering
- [ ] **Phase 2: JWT Authentication** - Replace X-API-Key header with single-user login/password JWT auth via HttpOnly cookie
- [ ] **Phase 3: Async Pre-computation** - Non-blocking upload that auto-enqueues all 2^N-1 Over/HT combinations in background; polling endpoint for job status

## Phase Details

### Phase 1: Backend Filter Removal
**Goal**: API returns the full unfiltered metrics dataset; frontend controls what the user sees
**Depends on**: Nothing (first phase)
**Requirements**: FILT-01, FILT-02, FILT-03
**Success Criteria** (what must be TRUE):
  1. A response from /analyze contains rows regardless of how low their quantidade_entradas or percentual_green values are
  2. The response shape is unchanged (same fields, same structure) — only filter lines are gone
  3. All existing analysis: and export: Redis keys are flushed at deploy so no stale filtered results are served on cache hit
**Plans**: 1 plan

Plans:
- [ ] 01-01-PLAN.md — Remove display filters from pipeline + deploy-time Redis cache flush

### Phase 2: JWT Authentication
**Goal**: Users authenticate with username + password and receive a JWT; all protected endpoints validate the token instead of the API Key header
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. User can POST /auth/login with username + password and receive a JWT in an HttpOnly cookie and in the JSON response body (for Swagger)
  2. Any request to a protected endpoint without a valid JWT receives 401 Unauthorized
  3. User can POST /auth/logout and the session cookie is cleared
  4. The password stored in the environment is an argon2 hash — never plaintext
  5. CORS allow_origins is locked to the frontend domain (not wildcard) before cookie auth is active
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — Add JWT dependencies, auth settings, and JWT cookie middleware
- [ ] 02-02-PLAN.md — Create auth router (login/logout) and wire JWT into all endpoints + CORS

### Phase 3: Async Pre-computation
**Goal**: Uploading N spreadsheets automatically triggers computation of all 2^N-1 Over/HT combinations in background; user finds results ready without waiting
**Depends on**: Phase 2
**Requirements**: PREC-01, PREC-02, PREC-03, PREC-04, PREC-05, PREC-06
**Success Criteria** (what must be TRUE):
  1. POST /precompute with N files returns 202 Accepted with a job_id immediately (does not block until computation finishes)
  2. GET /jobs/{job_id} returns the current status (pending / running / completed / failed) and the cache_key when complete
  3. After all jobs complete, calling GET /analyze with the same file combination returns a cache hit — computation is not repeated
  4. The main API remains responsive during background computation (pipeline runs in thread pool, not on the event loop)
  5. Jobs stored in Redis expire via TTL — stale "in progress" entries do not accumulate after a worker crash
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Backend Filter Removal | 0/1 | Not started | - |
| 2. JWT Authentication | 0/2 | Not started | - |
| 3. Async Pre-computation | 0/? | Not started | - |
