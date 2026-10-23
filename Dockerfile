# GAME HUB PROJECT AUDITOR — өндірістік Docker бейнесі
# Ресми Playwright негізі (Chromium + жүйелік тәуелділіктер орнатылған)
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Тәуелділіктерді алдымен көшіру (кэш тиімділігі)
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --no-audit --no-fund

# Бастапқы код
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY fixtures/ fixtures/

# Клиентті құрастыру
RUN npm run build -w client

# Өндірістік әдепкі параметрлер (override: docker run -e ...)
ENV NODE_ENV=production \
    PORT=8787 \
    ALLOW_LOCALHOST_FOR_TESTS=0 \
    DATA_DIR=/app/data

EXPOSE 8787
VOLUME /app/data

CMD ["npm", "run", "start", "-w", "server"]
