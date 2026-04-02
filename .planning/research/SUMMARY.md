# Project Research Summary

**Project:** dash-tg — Melhorias v2 (async pre-computation, auth migration, filter removal)
**Domain:** Brownfield FastAPI + Redis + pandas analytics API — single-user, single-VPS
**Researched:** 2026-04-02
**Confidence:** HIGH

## Executive Summary

This is a targeted, three-feature improvement milestone on an existing production FastAPI + Redis + pandas backend. The project is not a greenfield build — the pipeline, caching strategy, and deployment model are already proven. The three features are: (1) remove backend display filters so the frontend controls row visibility, (2) replace X-API-Key header auth with single-user login/password JWT auth, and (3) implement async pre-computation of all 2^N-1 spreadsheet combinations for the Over/HT strategy. Each feature is self-contained with clean dependency ordering: filter removal has no dependencies, auth migration depends only on itself, and pre-computation depends on both preceding phases being stable.

The recommended approach leans on the existing infrastructure: no new databases, no Celery, no RabbitMQ. Pre-computation runs as a `ThreadPoolExecutor`-backed background dispatcher inside the existing FastAPI process, with all job state stored in Redis under a `job:{job_id}` key. Auth uses PyJWT + pwdlib (both actively maintained, both officially recommended in current FastAPI docs) issuing a JWT served as an HttpOnly cookie. The filter removal is a single code deletion in `routers/analysis.py` — the lowest-risk change of the three.

The critical risks are: (a) running pandas pipeline work on the async event loop without offloading to a thread pool — this will starve the API under any concurrent load; (b) deploying filter removal without coordinating cache invalidation and frontend readiness — stale filtered results will be served from Redis to an unfiltered-aware frontend; (c) storing the JWT in `localStorage` instead of an HttpOnly cookie — any XSS vector in the frontend yields full account compromise. All three risks are well-understood and preventable with known patterns documented in PITFALLS.md.

---

## Key Findings

### Recommended Stack

The existing stack (FastAPI, pandas, openpyxl, redis-py, uvicorn) is unchanged. Only two new packages are added. For pre-computation, SAQ (0.26.3) is the recommended async task queue — it is ARQ's active successor, uses Redis as its sole broker (no new infra), and has built-in job status tracking. However, ARCHITECTURE.md makes a strong case for skipping SAQ entirely in favor of `asyncio.create_task + ThreadPoolExecutor`, which keeps the worker in-process and avoids a second Docker service. This is the right call for a single-user VPS deployment. For auth, PyJWT (2.12.1) and pwdlib (0.3.0) are the current FastAPI-recommended libraries — python-jose is abandoned (2021, 8 CVEs) and passlib breaks on Python 3.13+.

**Core technologies:**
- `PyJWT>=2.12.1`: JWT sign/verify — FastAPI's officially documented replacement for abandoned python-jose
- `pwdlib[argon2]>=0.3.0`: Password hashing — FastAPI's officially documented replacement for unmaintained passlib
- `asyncio.create_task + ThreadPoolExecutor` (stdlib): Background combination dispatch — no new dependency, no extra Docker service; threads release GIL during pandas I/O
- `redis.asyncio` (already in redis-py 4+): Async Redis client — necessary to prevent sync Redis calls from blocking the event loop during 7x amplified background writes

### Expected Features

**Must have (table stakes):**
- `POST /auth/login` and `POST /auth/logout` — required to replace the X-API-Key flow; no login endpoint means no token
- Token validation dependency on all protected endpoints — replaces `verify_api_key`; without this, auth migration is incomplete
- Non-blocking upload response returning `job_id` immediately — blocking until all combinations complete causes timeout failures
- `GET /jobs/{job_id}/status` polling endpoint — without status, the frontend has no signal that pre-computation is done
- All combinations auto-enqueued on upload — the stated value proposition is "user uploads files and finds results already computed"
- Backend filters removed (`min_jogos`, `min_green_pct` deleted from pipeline) — frontend cannot filter data it never received
- Password stored as argon2/bcrypt hash in env — storing plaintext is a meaningful security gap even for single-user

**Should have (differentiators):**
- Per-combination labels in upload response (which file subsets were enqueued, with their `cache_key`) — frontend can attempt cache hits for combinations already computed in a prior session
- Bulk job status endpoint (`GET /jobs/status?ids=...`) — reduces polling round-trips when 7 jobs are running
- Job TTL bounded in Redis — prevents stale "in progress" state accumulating after worker crashes
- Configurable token expiry via `JWT_EXPIRE_HOURS` env var — consistent with existing `CACHE_TTL_ANALYSIS` pattern

**Defer (v2+):**
- Pre-computation for eSoccer — Dupla strategy — explicitly out of scope; Over/HT only
- Multi-user / registration system — out of scope; single hardcoded user in env
- WebSocket real-time job updates — polling every 2-3s is sufficient for 7 jobs completing in under 60s
- Refresh token rotation — adds complexity with no benefit for a single-user system
- Password reset flow — operator changes `.env` directly

### Architecture Approach

The architecture introduces a job layer between the HTTP layer and the existing synchronous pipeline. The `/precompute` endpoint accepts N files, immediately writes a `job:{job_id}` status key to Redis, fires `asyncio.create_task(dispatch_combinations(...))`, and returns the `job_id` with `202 Accepted`. The dispatcher uses `itertools.combinations` to generate all 2^N-1 subsets, then submits each as a `loop.run_in_executor(thread_pool, run_pipeline, combo_args)` call. Threads run the existing synchronous pipeline unchanged. On completion each thread writes to `analysis:{cache_key}` (existing prefix) and increments the job progress counter. The existing `/analyze` endpoint is untouched — it continues to serve on-demand requests and will cache-hit immediately for any pre-computed combination. New auth flows via a `routers/auth.py` router and a revised `middleware/auth.py` that validates JWT from the cookie instead of an `X-API-Key` header.

**Major components:**
1. `routers/precompute.py` (new) — `POST /precompute` and `GET /jobs/{id}/status` endpoints
2. `services/job_registry.py` (new) — read/write `job:{job_id}` state in Redis; stale-detection logic
3. `services/dispatcher.py` (new) — combination enumeration via `itertools.combinations`; ThreadPoolExecutor submission; progress updates
4. `routers/auth.py` (new) — `POST /token` login; sets HttpOnly cookie; returns Bearer token for API clients
5. `middleware/auth.py` (modified) — replace `API_KEYS` env check with `PyJWT.decode()` from cookie or Bearer header
6. `routers/analysis.py` (modified) — remove 2-line filter block (`min_jogos`, `min_green_pct`)
7. Existing pipeline services (loader, normalizer, deduplicator, metrics) — unchanged

### Critical Pitfalls

1. **CPU-bound pandas work on the event loop** — never call the pipeline from a bare `async def` or `BackgroundTasks.add_task()` without `run_in_executor`; this blocks all concurrent requests for the duration of computation. Use `starlette.concurrency.run_in_threadpool` or `loop.run_in_executor(ThreadPoolExecutor, ...)`.

2. **Stale filtered cache after filter removal** — the existing `analysis:` and `export:` Redis keys contain filtered results; deploying filter removal without flushing these keys means the new unfiltered-aware frontend will receive old filtered data on cache hits. Flush all `analysis:` and `export:` keys at deploy time. Coordinate frontend deploy to handle unfiltered response before backend change ships.

3. **JWT in localStorage exposes token to XSS** — issue the JWT as `HttpOnly; Secure; SameSite=Strict` cookie. Also keep a `Bearer` token in the JSON response body for API clients and Swagger. Do not store the token in `localStorage`.

4. **CORS `allow_origins=["*"]` becomes a CSRF vector after cookie auth** — `X-API-Key` headers are CSRF-safe by nature; cookies are not. Lock down `allow_origins` to the actual frontend domain before deploying cookie auth. This is a prerequisite, not a follow-up.

5. **Combinatorial memory explosion on concurrent combination execution** — running all 7 combinations simultaneously for N=3 files can peak at 350-700 MB on a VPS with 1-2 GB RAM. Run combinations sequentially in the background task, with explicit `del result; gc.collect()` between iterations. Sequential execution still completes in ~30-60s background time, which is acceptable.

---

## Implications for Roadmap

Based on research, the three features have a natural dependency ordering that is unanimous across STACK.md, FEATURES.md, ARCHITECTURE.md, and PITFALLS.md. Suggested phase structure:

### Phase 1: Backend Filter Removal

**Rationale:** Zero dependencies, zero new packages, lowest risk. A pure code deletion. Must be deployed before the pre-computation phase, because pre-computation results stored without filters need to be consumed by a frontend that already handles unfiltered data. Getting this out of the way first de-risks everything downstream.

**Delivers:** Full metrics dataset returned from `/analyze` and all pre-computed results. Frontend gains control over `min_jogos` and `min_green_pct` filtering. Unblocks frontend filter UI implementation.

**Addresses:** "Filters removed from backend response" (table stakes, FEATURES.md)

**Avoids:** Pitfall 4 (stale filtered cache). Requires: flush all `analysis:` + `export:` Redis keys at deploy; coordinate with frontend readiness for unfiltered payload.

**Research flag:** Standard pattern — no further research needed.

---

### Phase 2: JWT Authentication (Replace X-API-Key)

**Rationale:** Auth must be stable before new endpoints are added in Phase 3. Changing the auth contract on existing endpoints while simultaneously adding new ones creates a wider blast radius if the auth implementation has a bug. New packages (`PyJWT`, `pwdlib`) are isolated to one new router and one modified middleware file — easy to review and test in isolation.

**Delivers:** `POST /token` login endpoint, `POST /auth/logout`, JWT served as HttpOnly cookie, `verify_session` dependency replacing `verify_api_key` on all protected routes, Bearer token fallback for Swagger UI.

**Uses:** PyJWT 2.12.1, pwdlib[argon2] 0.3.0 (STACK.md)

**Implements:** `routers/auth.py` (new), `middleware/auth.py` (modified), `config/settings.py` additions (ARCHITECTURE.md)

**Avoids:**
- Pitfall 5: JWT in localStorage — use HttpOnly cookie
- Pitfall 6: CORS wildcard CSRF — lock `allow_origins` to frontend domain as part of this phase
- Pitfall 7: Swagger breakage — keep Bearer token in JSON response alongside cookie
- Pitfall 10: Plaintext password — store only argon2 hash in env
- Pitfall 12: Weak JWT secret — generate with `openssl rand -hex 32`

**Research flag:** Standard pattern — PyJWT + pwdlib pattern is well-documented in current FastAPI official docs. No further research needed.

---

### Phase 3: Async Pre-computation

**Rationale:** Most complex feature; depends on Phases 1 and 2 being stable. Phase 1 ensures pre-computed results have the correct (unfiltered) shape. Phase 2 ensures the new `/precompute` endpoint has stable auth from day one. The `filedf:` Redis cache (already implemented) is the critical optimization that makes concurrent combination runs fast — files are loaded once per job, not once per combination.

**Delivers:** `POST /precompute` endpoint (non-blocking, returns `job_id` immediately), `GET /jobs/{job_id}/status` polling endpoint, background combination dispatcher using ThreadPoolExecutor, `job:{job_id}` Redis status tracking with stale-detection, all 2^N-1 combinations pre-computed and stored under existing `analysis:{cache_key}` prefix for immediate cache hits on subsequent `/analyze` calls.

**Uses:** `asyncio.create_task + ThreadPoolExecutor` (stdlib), `redis.asyncio` migration (STACK.md + ARCHITECTURE.md)

**Implements:** `routers/precompute.py` (new), `services/job_registry.py` (new), `services/dispatcher.py` (new), `services/cache.py` (migrated to async Redis client) (ARCHITECTURE.md)

**Avoids:**
- Pitfall 1: GIL blocking event loop — use `run_in_threadpool`, never bare coroutine
- Pitfall 2: Silent failures — wrap each combination in try/except; write error details to status key
- Pitfall 3: Memory explosion — sequential combination execution + explicit `gc.collect()` per iteration
- Pitfall 8: Sync Redis calls amplified by 7x — migrate to `redis.asyncio` before adding background tasks
- Pitfall 9: Cache key correctness — verify `MD5(sorted file bytes + strategy)` for combinations matches direct `/analyze` cache key; do not include session ID or timestamps
- Pitfall 11: Orphaned tasks on restart — add `started_at` + stale-detection in job_registry; startup hook to mark stale keys as `failed`
- Pitfall 13: Redundant re-computation — check if all combination cache keys already exist in Redis before enqueueing

**Research flag:** Needs care during implementation. The ThreadPoolExecutor concurrency model with Redis state updates requires careful sequencing. The stale-detection logic for job recovery is non-trivial. Recommend a focused implementation spike for `services/dispatcher.py` and `services/job_registry.py` before wiring the router.

---

### Phase Ordering Rationale

- **Filter removal first** because it is risk-free and its deployment (with cache flush) is a prerequisite for pre-computed results to have the correct shape.
- **Auth second** because new endpoints in Phase 3 should be secured from the start; retrofitting auth onto a working pre-computation system is harder than building auth first.
- **Pre-computation third** because it depends on a stable auth surface and unfiltered pipeline output; it is also the highest-complexity change and benefits from the reduced scope of the preceding phases.
- This ordering is consistent across all four research files — no conflicts.

### Research Flags

Phases needing deeper research during planning:
- **Phase 3 (Async Pre-computation):** The `dispatcher.py` + `job_registry.py` interaction under concurrent modification needs careful design. Specifically: Redis atomic increment for progress updates (`HINCRBY`), how to handle partial failures (one combination fails, others succeed), and the stale-detection startup hook pattern.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Filter Removal):** Pure code deletion. Pattern is trivially clear.
- **Phase 2 (JWT Auth):** FastAPI's official JWT + cookie auth tutorial covers this completely with the recommended library stack.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | PyJWT and pwdlib versions confirmed via PyPI and FastAPI official PR migrations. ThreadPoolExecutor pattern confirmed via FastAPI official docs. SAQ version confirmed via PyPI (though SAQ is ultimately not needed). |
| Features | HIGH | Table stakes derived from project requirements (PROJECT.md) cross-referenced with FastAPI async task and auth patterns. Anti-features are explicitly scope-bounded. |
| Architecture | HIGH | Component boundaries derived from existing codebase structure and well-documented FastAPI patterns. ThreadPoolExecutor vs ProcessPoolExecutor decision is well-reasoned (pandas GIL release during numpy ops). |
| Pitfalls | HIGH | Critical pitfalls verified against FastAPI official docs, confirmed CVE reports (python-jose), and firsthand implementation reports. CSRF + cookie auth pitfall is confirmed security principle. |

**Overall confidence:** HIGH

### Gaps to Address

- **Sequential vs concurrent combination execution trade-off:** PITFALLS.md recommends sequential execution (memory safety), while ARCHITECTURE.md suggests concurrent with `max_workers=min(4, cpu_count)`. These are in tension. During Phase 3 implementation, measure actual peak memory usage with the VPS's specific RAM limit before deciding. Start sequential; add concurrency only if latency is unacceptable and memory headroom exists.

- **`redis.asyncio` migration scope:** The existing codebase uses synchronous `redis-py` throughout. PITFALLS.md flags this as a prerequisite for Phase 3. The migration scope (how many call sites, which services) needs assessment before Phase 3 begins — this is not a small change if the sync client is deeply embedded.

- **CORS `allow_origins` current value:** PITFALLS.md references `allow_origins=["*"]` as a confirmed concern in CONCERNS.md. This must be resolved as part of Phase 2, not deferred. Needs confirmation of the actual frontend domain(s) for the CORS allowlist.

- **Token expiry alignment (cookie `max_age` vs JWT `exp`):** Pitfall 14 notes these must match. Default value for `JWT_EXPIRE_HOURS` should be decided (24h recommended for single-user convenience) and documented in `.env.example`.

---

## Sources

### Primary (HIGH confidence)
- FastAPI official security docs — https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/ — JWT + pwdlib + PyJWT auth patterns
- FastAPI BackgroundTasks official docs — https://fastapi.tiangolo.com/tutorial/background-tasks/ — async task limitations
- PyJWT PyPI (2.12.1, Mar 2026) — https://pypi.org/project/PyJWT/
- pwdlib PyPI (0.3.0, Oct 2025) — https://pypi.org/project/pwdlib/
- FastAPI JWT migration PR #11589 — https://github.com/fastapi/fastapi/pull/11589 — confirms PyJWT as official replacement
- python-jose abandonment — https://github.com/fastapi/fastapi/discussions/11345 — FastAPI maintainer confirms migration
- passlib/pwdlib migration — https://github.com/fastapi/fastapi/discussions/11773 — confirms passlib deprecation
- ARQ maintenance-only — https://github.com/python-arq/arq/issues/437 — ARQ GitHub issue confirming status
- SAQ PyPI (0.26.3, Mar 2026) — https://pypi.org/project/saq/
- pandas docs (thread safety / GIL) — https://pandas.pydata.org/docs/user_guide/gotchas.html

### Secondary (MEDIUM confidence)
- Managing Background Tasks: BackgroundTasks vs ARQ — https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/
- Managing Long-Running Operations in FastAPI — https://leapcell.io/blog/managing-background-tasks-and-long-running-operations-in-fastapi
- FastAPI run_in_executor vs run_in_threadpool — https://sentry.io/answers/fastapi-difference-between-run-in-executor-and-run-in-threadpool/
- FastAPI Security Design Pitfalls — https://blog.greeden.me/en/2025/10/14/a-beginners-guide-to-serious-security-design-with-fastapi-authentication-authorization-jwt-oauth2-cookie-sessions-rbac-scopes-csrf-protection-and-real-world-pitfalls/
- Celery vs ARQ comparison — https://leapcell.io/blog/celery-versus-arq-choosing-the-right-task-queue-for-python-applications
- FastAPI Best Practices (zhanymkanov) — https://github.com/zhanymkanov/fastapi-best-practices

### Tertiary (LOW confidence / inferred)
- "Store progress metadata directly in Redis" pattern for SAQ — inferred from common FastAPI + Redis patterns; not verified against a specific authoritative source for this exact use case

---

*Research completed: 2026-04-02*
*Ready for roadmap: yes*
