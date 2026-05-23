# Immagine ufficiale Playwright per Node: include Node 20 + Chromium gia preinstallato
# in /ms-playwright (env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright e' settato dall'immagine).
# IMPORTANTE: la versione (v1.60.0) DEVE coincidere con quella di "playwright"
# in package.json, altrimenti Playwright cerchera un binario diverso da quello presente.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# I browser sono gia' presenti nell'immagine: salta il download durante l'install npm.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copia solo i manifest prima, per sfruttare la cache layer.
COPY package*.json ./

# npm ci se c'e' il lock file (build deterministico, piu' veloce); fallback a npm install.
RUN npm ci || npm install

# Copia il resto del codice.
COPY . .

ENV NODE_ENV=production

# Render inietta PORT a runtime; espongo 3000 come default per dev locale.
EXPOSE 3000

CMD ["npm", "start"]
