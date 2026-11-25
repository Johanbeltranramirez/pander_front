# ── Imagen del frontend de Pander (React + Vite → NGINX) ──────

# Etapa 1: compilar con Node
FROM node:22-alpine AS build
WORKDIR /app

# pnpm queda fijado por "packageManager" en package.json
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Vacío = el navegador llama a la misma URL del sitio (el Ingress manda /api al backend).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

# Etapa 2: servir los archivos estáticos con NGINX
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
