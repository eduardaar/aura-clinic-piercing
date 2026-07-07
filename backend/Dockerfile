# Backend Aura Clinic (Node 20) para produção.
FROM node:20-alpine
WORKDIR /app

# Instala só dependências de produção (cache eficiente).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código da aplicação.
COPY . .

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/index.js"]
