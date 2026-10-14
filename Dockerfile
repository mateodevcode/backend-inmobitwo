FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:24-alpine
WORKDIR /app
# SSH (ejecución remota de dominios) + dig (verificación DNS previa)
RUN apk add --no-cache openssh-client bind-tools
COPY --from=builder /app .
EXPOSE 3001
CMD ["node", "src/index.js"]
