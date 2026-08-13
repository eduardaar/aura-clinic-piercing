# Backend Aura Clinic (Node 20) para produção.
FROM node:20-alpine
WORKDIR /app

# Instala só dependências de produção (cache eficiente).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código da aplicação. O usuário `node` já existe na imagem oficial; entregar
# os arquivos a ele permite executar a API sem UID 0 e ainda mantém os
# diretórios de fallback de uploads graváveis no desenvolvimento/migração.
COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node
CMD ["node", "src/index.js"]
