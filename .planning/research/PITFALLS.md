# Domain Pitfalls

**Domain:** FastAPI + Redis + pandas — async pre-computation, filter removal, auth migration
**Researched:** 2026-04-02
**Confidence:** HIGH (verified against FastAPI official docs, pandas docs, multiple implementation reports)

---

## Critical Pitfalls

### Pitfall 1: BackgroundTasks Does Not Escape the GIL for CPU-Bound Work

**What goes wrong:** The developer wraps the pandas pipeline in `background_tasks.add_task(compute_combinations, files, strategy)` and calls it async. The API appears to return immediately, but any concurrent request still blocks — because `BackgroundTasks` dispatches to the same thread pool as the event loop, and Python's GIL prevents true parallelism for CPU-bound code. With 7 combinations of 150k-row DataFrames, total CPU time easily exceeds 30–60 seconds per upload, starving all concurrent requests.

**Why it happens:** FastAPI's `BackgroundTasks` is documented for fire-and-forget I/O tasks (sending emails, writing logs). For CPU-bound pandas operations — groupby, merge, dedup, metric computation — async does not help. The GIL ensures only one thread executes Python bytecode at a time regardless of the async wrapper.

**Consequences:** The API becomes unresponsive during background computation. If two users upload simultaneously, one queues behind the other. The problem is invisible in single-user smoke tests but surfaces immediately in any concurrent scenario.

**Prevention:** Run the combination pipeline in a separate thread pool using `asyncio.to_thread()` or `starlette.concurrency.run_in_threadpool()`. This releases the event loop to handle other requests while the CPU work happens on a worker thread. For this single-user deployment, `run_in_threadpool` is sufficient — Celery adds infrastructure complexity that is not justified here.

```python
from starlette.concurrency import run_in_threadpool

async def precompute_all_combinations(files_bytes, strategy):
    await run_in_threadpool(_compute_combinations_sync, files_bytes, strategy)
```

**Warning signs:** Upload response time grows with number of files. `/health` endpoint becomes slow or times out during an active computation.

**Phase:** Async pre-computation phase (Phase 1).

---

### Pitfall 2: No Status Tracking — Client Has No Way to Know When Pre-computation Finishes

**What goes wrong:** The upload endpoint returns 200 immediately, the background task begins, but there is no mechanism for the frontend to know when the 7 combinations are ready. The frontend either polls `/analyze` (which might return stale cache or trigger re-computation) or blindly waits a fixed time. If the background task fails silently, the user never knows.

**Why it happens:** FastAPI `BackgroundTasks` provides zero built-in status, progress, or failure reporting. Exceptions raised inside `background_tasks.add_task(fn)` are swallowed unless explicitly caught and written to an external store.

**Consequences:** Silent failures leave the cache empty while the UI shows "processing complete." Errors in any one combination (e.g., a file with malformed data) kill the entire background task with no user-facing feedback. The frontend has no reliable signal to trigger a "results are ready" refresh.

**Prevention:** Use Redis as the status store. Write a status key before launching background work, update it per combination as they complete, and write a final status on success or error.

```python
# Pattern: status:{upload_id} = {"total": 7, "done": 0, "errors": []}
# Each combination writes its result to analysis:{cache_key}
# Background task updates status key atomically on each completion
```

Expose a `GET /precompute/status/{upload_id}` endpoint. Wrap each combination computation in try/except and write error details to the status key — never let exceptions propagate silently.

**Warning signs:** Frontend shows "loading" indefinitely after upload. Redis has no `status:` keys despite active processing.

**Phase:** Async pre-computation phase (Phase 1).

---

### Pitfall 3: Combinatorial Memory Explosion — All 7 DataFrames In-Process Simultaneously

**What goes wrong:** For n=3 files with 150k rows each, computing all 2^3 - 1 = 7 combinations naively means holding up to 7 separate DataFrames in memory concurrently. A single 150k-row DataFrame with the full column set is ~50–100 MB. Running all 7 combinations simultaneously inside one background task creates 350–700 MB of peak memory pressure on a VPS that may have 1–2 GB total. The Docker container OOM-kills the process mid-computation, silently clearing the status key and leaving the cache in a partial state.

**Why it happens:** The natural implementation iterates over combinations and fires them all concurrently. pandas `concat`, `merge`, and `groupby` operations create intermediate copies. The existing codebase already stores pickled DataFrames in Redis (`filedf:{md5}`) which adds additional memory per file.

**Consequences:** Container restart during background computation. Partial cache state: some combinations cached, others not. No user-facing error since the process died. The partial state persists in Redis for 24h, causing inconsistent results on subsequent requests.

**Prevention:** Compute combinations sequentially, not concurrently, in the background task. This trades latency for memory stability. For n=3 files, 7 sequential combinations at 150k rows is still fast enough (~30–60s total) for a background pre-computation model. Additionally, explicitly `del df` and `gc.collect()` after storing each combination result to Redis before beginning the next.

```python
for combination in all_combinations(files):
    result = compute_pipeline(combination)
    store_to_redis(result)
    del result  # explicit release before next combination
    gc.collect()
```

**Warning signs:** Container memory usage climbs past 80% during uploads. Redis keys from previous computation are missing after a new upload. Docker logs show OOM kill events.

**Phase:** Async pre-computation phase (Phase 1).

---

### Pitfall 4: Removing Backend Filters Silently Breaks the Existing Frontend and Export

**What goes wrong:** The developer removes `min_jogos` and `min_green_pct` filtering from `_analyze_with_strategy()` and deploys. The existing frontend, which was built expecting filtered results, now receives 10–100x more rows per response. The export `.xlsx` also grows. The frontend's table rendering slows or crashes. Cached results from before the change are filtered; results after are unfiltered — the same `cache_key` formula returns different result shapes depending on deploy time.

**Why it happens:** The response contract changed (more rows, same structure) but the cache key did not change. Redis may serve old filtered results to the new frontend, or new unfiltered results to the old frontend, with no version signal in the response.

**Consequences:** Frontend table renders 500+ rows when it previously rendered 20. Export file size jumps from 50KB to 5MB. Existing `analysis:` cache entries return filtered data while new entries return unfiltered — two users with the same files get different row counts depending on which hit the cache first.

**Prevention:** 
1. Coordinate the deployment: update frontend to handle unfiltered data before removing backend filters, or deploy both simultaneously.
2. Invalidate all existing `analysis:` and `export:` cache entries at deploy time — the data shape has fundamentally changed.
3. Add an `api_version` field to the response or change the cache key formula to include a schema version, so stale filtered results are never served to the new frontend.
4. Keep `total_rows_unfiltered` in the response metadata so the frontend can implement its own filtering without a second API call.

**Warning signs:** Frontend table row count is inconsistent between page refreshes. Export file size varies unexpectedly. Redis hit rate stays high after the deploy (old filtered results being served).

**Phase:** Filter removal phase (Phase 2).

---

### Pitfall 5: JWT in localStorage Instead of HttpOnly Cookie — XSS Exposes the Auth Token

**What goes wrong:** The developer implements login/password and issues a JWT, then stores it in `localStorage` so the frontend JavaScript can attach it as a `Bearer` header. Any XSS vulnerability in the frontend (including third-party scripts) can read `localStorage` and exfiltrate the token. For a single-user dashboard with sensitive betting analysis data, this is a meaningful risk.

**Why it happens:** The `Bearer` token pattern is the default example in FastAPI's official security documentation. It is the path of least resistance, especially for APIs originally designed for machine clients (API keys). Frontend developers often reach for `localStorage` because it persists across page refreshes and is easy to read from JavaScript.

**Consequences:** A malicious script (ad network, analytics vendor, compromised CDN) silently exfiltrates the JWT. Since there is only one user and one valid password, token theft = full account compromise with no revocation possible until the secret key is rotated.

**Prevention:** Issue the JWT as an `HttpOnly; Secure; SameSite=Strict` cookie. The browser attaches it automatically to same-origin requests and JavaScript cannot read it. The FastAPI endpoint reads it via `Request.cookies.get("access_token")` instead of the `Authorization` header.

```python
response.set_cookie(
    key="access_token",
    value=f"Bearer {token}",
    httponly=True,
    secure=True,       # only over HTTPS
    samesite="strict",
)
```

**Warning signs:** Frontend code calls `localStorage.setItem("token", ...)`. The `/login` response returns the token in the JSON body (not `Set-Cookie` header). Browser DevTools shows the token readable under Application > Local Storage.

**Phase:** Auth migration phase (Phase 3).

---

### Pitfall 6: CSRF Blind Spot When Switching from API Key to Cookie Auth

**What goes wrong:** The API key in `X-API-Key` header is inherently CSRF-safe — a malicious website cannot set custom request headers from the browser. Switching to cookie-based auth removes this protection. With `SameSite=Strict` on the cookie and `allow_origins=["*"]` on CORS, a malicious page cannot directly call the API — but relaxing CORS later (or if `SameSite` is set to `Lax`) reopens the attack surface.

**Why it happens:** Developers migrating auth focus on "does login work?" and miss that the threat model changed. The existing CORS config (`allow_origins=["*"]`) was acceptable with header-based API keys (browsers cannot forge `X-API-Key` cross-origin) but becomes actively dangerous with cookie auth.

**Consequences:** A malicious website can trigger state-changing requests (file uploads, cache deletion) using the victim's browser session cookie, if CORS is wide-open and `SameSite` is not strictly enforced.

**Prevention:**
1. Restrict `allow_origins` to the actual frontend domain before deploying cookie auth — this is listed as a concern in CONCERNS.md and must be fixed as part of auth migration, not after.
2. Set `SameSite=Strict` on the auth cookie.
3. For the `/analyze` (file upload) endpoint specifically, validate `Origin` or add a CSRF double-submit token.

**Warning signs:** `allow_origins=["*"]` is still present in `main.py` after auth migration. The `Set-Cookie` header lacks `SameSite=Strict`. No CSRF token in the login flow.

**Phase:** Auth migration phase (Phase 3). Cannot deploy cookie auth without fixing CORS first.

---

### Pitfall 7: Swagger UI (`/docs`) Becomes Unusable After Cookie Auth Migration

**What goes wrong:** The existing API key auth works seamlessly in Swagger UI via the `X-API-Key` header — developers can test endpoints directly. After switching to cookie-based auth, Swagger UI cannot handle `HttpOnly` cookies: there is no Swagger mechanism to set cookies from the UI, so every test endpoint returns 401. The developer must either maintain a parallel API key path or lose the Swagger testing workflow entirely.

**Why it happens:** FastAPI's OpenAPI spec supports `apiKey` in header natively. Cookie auth requires `oauth2PasswordBearer` or a custom `APIKeyInCookie` scheme, neither of which Swagger UI manages as transparently. HttpOnly cookies cannot be set by JavaScript, so Swagger's JS client cannot inject them.

**Consequences:** The test/debug loop slows significantly. Developers switch to `curl` or Postman. Integration tests that used the Swagger client break. Documentation loses its "Try it out" functionality.

**Prevention:** Implement a `/login` endpoint that returns both a cookie (for browser use) and a JSON body token (for API clients and Swagger). Register a custom `SecurityScheme` in FastAPI for the Bearer token fallback so Swagger can still authenticate. Keep the API testable via `Authorization: Bearer <token>` header even when the primary auth path is cookie-based.

```python
# /login returns both:
response.set_cookie("access_token", token, httponly=True, ...)
return {"access_token": token, "token_type": "bearer"}  # for API clients
```

**Warning signs:** After auth migration, `/docs` "Authorize" button is removed or non-functional. Test scripts start hardcoding credentials inline.

**Phase:** Auth migration phase (Phase 3).

---

### Pitfall 8: Synchronous Redis Calls Block the Event Loop During Pre-computation

**What goes wrong:** The current codebase uses synchronous `redis-py` (`redis.from_url()`) called from `async` handlers — already flagged in CONCERNS.md as a minor issue. This becomes a critical issue during background pre-computation: the background task writes 7 results to Redis using blocking Redis calls while the event loop is trying to serve other requests. Each `redis.set()` call blocks the event loop for the duration of the network round-trip to Redis.

**Why it happens:** The existing sync Redis client was fine for the original synchronous-by-nature request processing. Pre-computation amplifies the problem: instead of 1–2 Redis writes per request, the background task does 14–21 writes (7 results + 7 status updates), all blocking.

**Consequences:** Other requests queue behind Redis I/O during active pre-computation. The `/health` endpoint becomes slow. Under any concurrent load, latency spikes during uploads.

**Prevention:** Switch the cache service to `redis.asyncio` (the async client bundled in `redis-py` 4+) before implementing background pre-computation. Alternatively, wrap all Redis calls in `asyncio.to_thread()`. Given the existing sync client is already a concern, migrate to async Redis as part of the pre-computation phase.

```python
import redis.asyncio as aioredis
client = aioredis.from_url(settings.REDIS_URL)
await client.set(key, value, ex=ttl)
```

**Warning signs:** API latency increases during background computation. `redis-py` sync client (`redis.Redis`) still used after pre-computation is added.

**Phase:** Async pre-computation phase (Phase 1) — fix before adding background tasks.

---

## Moderate Pitfalls

### Pitfall 9: Combination Cache Keys Must Include the Set of Files, Not Just Individual File Hashes

**What goes wrong:** The current cache key is `MD5(sorted file bytes + strategy)`. For pre-computation, the developer reuses the same formula for combinations. When the user uploads files A, B, C and the system pre-computes A+B+C, A+B, A+C, B+C, A, B, C — the combination A+B generates the same cache key as if the user had uploaded only A and B originally, because the key only depends on the files in the combination, not on the upload session. This is actually correct behavior, but if the cache key also incorporates any session state or timestamp, combinations will never hit the cache from a direct user request.

**Why it happens:** Cache key design for combinations requires deliberate thought. The key must identify "these exact files combined with this strategy" independent of whether it was pre-computed or requested directly.

**Prevention:** The existing `MD5(sorted file bytes + strategy)` formula is correct for this purpose — sorted file bytes ensure order independence, and the combination subset is just a different sorted set. Verify this explicitly: a pre-computed A+B cache key must match the key generated when a user later requests only A+B. Do not add any session ID, timestamp, or combination index to the key.

**Warning signs:** Direct `/analyze` requests with files A+B return cache misses even after pre-computation. Cache hit rate stays at 0% after pre-computation completes.

**Phase:** Async pre-computation phase (Phase 1).

---

### Pitfall 10: Password Stored in Environment Variable Without Hashing

**What goes wrong:** The simplest implementation stores `LOGIN_PASSWORD=mysecret` in `.env` and compares it directly against the submitted password. If the `.env.prod` file is ever exposed (already a concern in CONCERNS.md — it is currently committed to git), the plaintext password is immediately compromised. Since there is one user and one password, this is a full account compromise.

**Why it happens:** Single-user auth feels like it doesn't need the same rigor as multi-user. The developer sees bcrypt as "enterprise overhead."

**Consequences:** Credential exposure from git history, log files, or env var leakage (Docker inspect, CI logs) directly yields admin access.

**Prevention:** Store only the bcrypt hash of the password in the environment variable. At login, run `bcrypt.checkpw(submitted, stored_hash)`. The hash itself is useless to an attacker without the plaintext.

```python
import bcrypt
# Generating the hash (run once, store the output in .env):
# bcrypt.hashpw(b"mysecret", bcrypt.gensalt()).decode()

# Verifying at login:
stored_hash = settings.LOGIN_PASSWORD_HASH.encode()
if not bcrypt.checkpw(password.encode(), stored_hash):
    raise HTTPException(status_code=401, detail="Credenciais inválidas")
```

**Warning signs:** `.env` contains `LOGIN_PASSWORD=` (plaintext). Login handler uses `== password` comparison.

**Phase:** Auth migration phase (Phase 3).

---

### Pitfall 11: Background Task Orphaned on Server Restart — No Recovery

**What goes wrong:** The VPS restarts or Docker restarts the container while a background pre-computation is running (covering 6 of 7 combinations). The status key in Redis shows `{"done": 6, "total": 7, "errors": []}` — never reaching completion. The frontend polls forever or shows a stale "in progress" state. The partial cache is valid but the user does not know the 7th combination failed.

**Why it happens:** FastAPI `BackgroundTasks` runs in-process. When the process exits, tasks die without checkpoint or recovery. Redis retains whatever was written before the crash, but there is no re-queue mechanism.

**Prevention:** 
1. Add a `started_at` timestamp to the status key. If `now - started_at > timeout_threshold` and status is not complete, mark it as failed.
2. Implement a cleanup endpoint or startup hook that scans for stale `status:` keys and marks them as `{"status": "failed", "reason": "server_restart"}`.
3. Document this limitation explicitly — for this single-user use case, a "retry upload" UX is sufficient recovery.

**Warning signs:** Redis contains `status:` keys with `done < total` from timestamps more than 5 minutes old.

**Phase:** Async pre-computation phase (Phase 1).

---

### Pitfall 12: JWT Secret Key Hardcoded or Too Short

**What goes wrong:** The developer sets `JWT_SECRET=supersecret` or `JWT_SECRET=changeme` in `.env`. Since `.env.prod` is already committed to git (CONCERNS.md Critical), and the JWT secret is the single point of failure for all session security, a weak or committed secret means tokens can be forged.

**Why it happens:** JWT secret gets set once and forgotten. For a personal dashboard it feels like overhead.

**Consequences:** With a known secret, an attacker can forge a valid JWT for any expiry without knowing the password. The entire login flow is bypassed.

**Prevention:** Generate the secret with `openssl rand -hex 32` (256 bits). Never commit it to git. Remove `.env.prod` from the repo as part of auth migration (already recommended in CONCERNS.md).

**Warning signs:** `JWT_SECRET` value is shorter than 32 characters. The value matches any common test string (`secret`, `dev`, `changeme`).

**Phase:** Auth migration phase (Phase 3).

---

## Minor Pitfalls

### Pitfall 13: Pre-computation Triggered on Every Upload, Even Identical Files

**What goes wrong:** The user uploads the same 3 files twice (e.g., after refreshing the page). The background task is triggered again, re-computing all 7 combinations even though they already exist in Redis with 24h TTL.

**Prevention:** Before launching background pre-computation, check if all 7 combination cache keys already exist in Redis. If they do, skip computation and return the existing status immediately. The existing MD5-based cache key formula makes this check O(n) Redis lookups.

**Phase:** Async pre-computation phase (Phase 1).

---

### Pitfall 14: Session Cookie Expiry Not Aligned with JWT Expiry

**What goes wrong:** The JWT has a 1-hour expiry but the cookie has `max_age=86400` (24 hours). The cookie persists in the browser for 24 hours, but after 1 hour the backend rejects requests with 401. The user sees an authenticated-looking UI (cookie is set) but all API calls fail.

**Prevention:** Set cookie `max_age` equal to the JWT `exp` claim. Or implement token refresh. For a single-user dashboard, a 24h JWT with a 24h cookie is the simplest correct configuration.

**Phase:** Auth migration phase (Phase 3).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Async pre-computation | GIL blocks event loop with CPU-bound pandas | Use `run_in_threadpool`, not bare `async def` |
| Async pre-computation | Silent background task failures | Write status to Redis; wrap in try/except; expose status endpoint |
| Async pre-computation | Combinatorial memory explosion | Sequential computation, explicit `del` + `gc.collect()` between combinations |
| Async pre-computation | Sync Redis calls amplified by 7x writes | Migrate to `redis.asyncio` before adding background tasks |
| Async pre-computation | Task orphaned on restart | Add `started_at` + stale-detection logic to status key |
| Filter removal | Stale filtered cache served to unfiltered-aware frontend | Flush `analysis:` + `export:` keys at deploy; coordinate frontend deploy |
| Filter removal | Response size increase breaks frontend table rendering | Frontend must implement client-side filtering before backend filter removal |
| Auth migration | JWT in localStorage exposes token to XSS | HttpOnly cookie only |
| Auth migration | CORS `allow_origins=["*"]` opens CSRF attack surface | Lock down CORS to frontend domain before enabling cookie auth |
| Auth migration | Swagger UI breaks with cookie auth | Keep Bearer token fallback for `/docs` testing |
| Auth migration | Plaintext password in `.env` | Store bcrypt hash only |
| Auth migration | Weak or committed JWT secret | 256-bit random secret, never in git |

---

## Sources

- [FastAPI BackgroundTasks official docs](https://fastapi.tiangolo.com/tutorial/background-tasks/) — HIGH confidence
- [Understanding Pitfalls of Async Task Management in FastAPI Requests](https://leapcell.io/blog/understanding-pitfalls-of-async-task-management-in-fastapi-requests) — MEDIUM confidence
- [Managing Background Tasks and Long-Running Operations in FastAPI](https://leapcell.io/blog/managing-background-tasks-and-long-running-operations-in-fastapi) — MEDIUM confidence
- [How I Handled Heavy Background Jobs in FastAPI Without Killing My API](https://medium.com/@connect.hashblock/how-i-handled-heavy-background-jobs-in-fastapi-without-killing-my-api-7cf4136af8de) — MEDIUM confidence (firsthand report)
- [FastAPI Mistakes That Kill Your Performance](https://dev.to/igorbenav/fastapi-mistakes-that-kill-your-performance-2b8k) — MEDIUM confidence
- [FastAPI Security — OAuth2 JWT](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — HIGH confidence
- [FastAPI Security Design Pitfalls](https://blog.greeden.me/en/2025/10/14/a-beginners-guide-to-serious-security-design-with-fastapi-authentication-authorization-jwt-oauth2-cookie-sessions-rbac-scopes-csrf-protection-and-real-world-pitfalls/) — MEDIUM confidence
- [pandas thread safety and memory docs](https://pandas.pydata.org/docs/user_guide/gotchas.html) — HIGH confidence
- [FastAPI Best Practices (zhanymkanov)](https://github.com/zhanymkanov/fastapi-best-practices) — MEDIUM confidence
- Project CONCERNS.md — HIGH confidence (authoritative codebase audit)
