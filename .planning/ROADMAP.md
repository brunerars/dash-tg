# Roadmap: Dashboard TG

## Milestones

- ✅ **v1.0 Backend Melhorias** - Phases 1-3 (shipped 2026-04-02)
- 🚧 **v2.0 Frontend Integration** - Phases 4-5 (in progress)

## Phases

<details>
<summary>✅ v1.0 Backend Melhorias (Phases 1-3) - SHIPPED 2026-04-02</summary>

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
- [x] 01-01-PLAN.md — Remove display filters from pipeline + deploy-time Redis cache flush

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
- [x] 02-01-PLAN.md — Add JWT dependencies, auth settings, and JWT cookie middleware
- [x] 02-02-PLAN.md — Create auth router (login/logout) and wire JWT into all endpoints + CORS

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
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Extract sync pipeline + add Redis job state infrastructure
- [x] 03-02-PLAN.md — Create precompute router (POST /precompute, GET /jobs) + wire into app

</details>

### 🚧 v2.0 Frontend Integration (In Progress)

**Milestone Goal:** Integrar o frontend React com JWT cookie auth, migrar API client de X-API-Key para cookies, e implementar polling de pre-computacao na tela Over/Under.

#### Phase 4: Auth Chain + API Migration
**Goal**: Users authenticate via a login page and every API call uses cookie auth — the old X-API-Key mechanism is fully removed
**Depends on**: Phase 3
**Requirements**: AUTH-FE-01, AUTH-FE-02, AUTH-FE-03, API-MIG-01, API-MIG-02
**Success Criteria** (what must be TRUE):
  1. User can navigate to /login, enter username + password, and reach the dashboard — the cookie is set and all subsequent API calls succeed
  2. Accessing any protected route without a valid session redirects to /login without a flash of the dashboard content
  3. Clicking logout clears the session, redirects to /login, and a subsequent back-navigation does not restore the dashboard
  4. Any mid-session 401 (expired token) redirects to /login automatically without a blank error screen
  5. No request to the backend carries an X-API-Key header — VITE_API_KEY is absent from all env files and build config
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 04-01-PLAN.md — Vite dev proxy + api.ts cookie migration + AuthContext + ProtectedRoute
- [ ] 04-02-PLAN.md — LoginPage + routes wiring + App.tsx AuthProvider + Layout logout button

#### Phase 5: Pre-compute Polling
**Goal**: Uploading files on the Over/Under page automatically triggers pre-computation and the UI shows live progress until all combinations are ready
**Depends on**: Phase 4
**Requirements**: PREC-FE-01, PREC-FE-02, PREC-FE-03
**Success Criteria** (what must be TRUE):
  1. Selecting files on the Over/Under page automatically calls POST /precompute without any additional user action
  2. The UI shows a progress indicator (X of N jobs complete) while jobs are running — the user knows computation is in flight
  3. When all jobs reach completed status, analysis results load automatically and the user sees data without clicking Analyze
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Backend Filter Removal | v1.0 | 1/1 | Complete | 2026-04-02 |
| 2. JWT Authentication | v1.0 | 2/2 | Complete | 2026-04-02 |
| 3. Async Pre-computation | v1.0 | 2/2 | Complete | 2026-04-02 |
| 4. Auth Chain + API Migration | v2.0 | 1/2 | In Progress|  |
| 5. Pre-compute Polling | v2.0 | 0/TBD | Not started | - |
