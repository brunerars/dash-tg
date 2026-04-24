FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Deps do Playwright Chromium (apenas o necessário)
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates fonts-liberation \
      libnss3 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
      libcairo2 libexpat1 libglib2.0-0 libdbus-1-3 \
      libxshmfence1 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Chromium para os scrapers (só na imagem — no target api o browser fica idle)
RUN python -m playwright install --with-deps chromium

COPY . /app

EXPOSE 8000

# --reload pra HMR do backend (dev loop). Em prod, remover --reload.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
