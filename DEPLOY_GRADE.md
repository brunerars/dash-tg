# Deploy — stack `dashtg-grade`

Stack paralela do dash-tg com a feature de grade integrada. Nao substitui
nada — sobe sob dominios proprios em paralelo ao dash-tg atual.

## Dominios

| Recurso | URL |
|---|---|
| Frontend | `https://dash-tg-grade.arvsystems.cloud` |
| API      | `https://api-dash-tg-grade.arvsystems.cloud` |

## Pre-requisitos

### DNS (Cloudflare/Hostinger)
Dois A-records apontando pro IP do manager:
- `dash-tg-grade.arvsystems.cloud`
- `api-dash-tg-grade.arvsystems.cloud`

### Secrets no GitHub Actions
Ja devem existir (vindos do workflow antigo do dash-tg):
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`

`GITHUB_TOKEN` e automatico.

## Passo 1 — disparar build

```bash
git checkout feat/grade
git push origin feat/grade
```

O workflow `.github/workflows/deploy-grade.yml` vai:
1. Buildar `api-grade` e `frontend-grade`
2. Publicar em `ghcr.io/<owner>/<repo>/<image>-grade:latest`
3. Fazer `docker pull` na VPS via SSH

Acompanhar em: **GitHub → Actions → CI/CD — Build Images (feat/grade stack)**.

## Passo 2 — criar stack no Portainer

**Portainer → Stacks → Add stack**

- **Name**: `dashtg-grade`
- **Build method**: `Repository`
- **Repository URL**: URL do repo
- **Repository reference**: `refs/heads/feat/grade`
- **Compose path**: `docker-compose.prod.grade.yml`

### Environment variables (aba "Environment variables")

```
IMAGE_API_GRADE=ghcr.io/<owner>/<repo>/api-grade
IMAGE_FRONTEND_GRADE=ghcr.io/<owner>/<repo>/frontend-grade
JWT_SECRET=<openssl rand -hex 32>
POSTGRES_PASSWORD=<senha forte>
APP_USERS=<user>:<argon2hash>
JWT_EXPIRE_MINUTES=720
SCRAPER_REFRESH_MIN=10
FAVORITES_SYNC_MIN=10
SCRAPER_MAX_WORKERS=2
```

Opcionais (com defaults sensatos):
```
CACHE_TTL_ANALYSIS=86400
CACHE_TTL_EXPORT=3600
CACHE_TTL_JOB=7200
PRECOMPUTE_WORKERS=2
```

### Gerar APP_USERS

```bash
docker run --rm python:3.11-slim bash -c "pip install -q pwdlib[argon2] && python -c 'from pwdlib import PasswordHash; print(PasswordHash.recommended().hash(\"SENHA_AQUI\"))'"
```

Formato final: `user1:$argon2id$...|||user2:$argon2id$...`

## Passo 3 — Deploy

Click **Deploy the stack**. Portainer puxa o compose do repo, cria 6 services
(api, workers, frontend, redis, postgres, e cache-flush-like...).

Primeira subida leva ~3 min (Chromium do Playwright pesa).

## Passo 4 — Validar

```bash
# API responde
curl https://api-dash-tg-grade.arvsystems.cloud/health
# → {"status":"ok"}

# Front carrega
curl -I https://dash-tg-grade.arvsystems.cloud
# → 200

# Scraper popula cache (aguardar 1-3 min apos subida)
docker service logs dashtg-grade_workers --tail 30
# → [SCRAPER_SCHED] refresh OK N em Xs
```

## Passo 5 — Smoke test no browser

1. Acessar `https://dash-tg-grade.arvsystems.cloud`
2. Login
3. Subir planilha
4. Flagar dupla
5. Abrir aba Favoritos → badge "N jogos" aparece
6. Abrir Grade do Dia → jogos listados

## Updates futuros

Cada push em `feat/grade` redispara workflow → novo `:latest` no GHCR → `docker pull`
roda sozinho na VPS. No Portainer: **Stack → Update → Pull latest image & redeploy**.

## Rollback

No Portainer → Stack `dashtg-grade` → **Stop** ou **Remove**. O dash-tg
atual continua intocado em `dash-tg.arvsystems.cloud`.

## Quando mergear pra producao unica

Depois de validar a stack paralela com o cliente:

1. `git checkout main && git merge feat/grade`
2. Atualizar `docker-compose.prod.yml` (nao o `.grade.yml`) incluindo postgres/workers
3. Atualizar workflow `deploy.yml` pra gerar as novas imagens
4. No Portainer: editar stack `dash-tg` existente, apontar pras novas imagens
5. Remover stack `dashtg-grade`

Ate la, a stack paralela fica como canary/staging.

## Custo de recursos (estimado)

| Service | RAM limite | RAM esperada |
|---|---|---|
| api | 768M | ~200M |
| workers | 1024M | ~400M (Chromium headless durante scrape) |
| frontend | 128M | ~30M |
| redis | — | ~50M |
| postgres | — | ~100M |
| **Total** | | **~780M** em uso normal |

Em VPS KVM4 (4G RAM) rodando ja o dash-tg + v3: fica justo. Monitorar
`docker stats` nas primeiras 48h.
