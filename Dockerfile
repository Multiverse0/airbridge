# Imagen de producción para AirBridge (Shopify Remix app)
FROM node:22-alpine

RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

WORKDIR /app

# Dependencias
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force
# La CLI de Shopify no se necesita en el servidor de producción
RUN npm remove @shopify/cli || true

# Código
COPY . .

# Prisma Client must be generated with its runtime engine when using
# the libSQL driver adapter. Using --no-engine causes startup to fail.
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Al arrancar: aplica migraciones (idempotente) y levanta el servidor
CMD ["npm", "run", "docker-start"]
