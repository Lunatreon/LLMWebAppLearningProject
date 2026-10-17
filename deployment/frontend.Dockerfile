FROM node:24.21.0-alpine AS frontend
WORKDIR /build/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
ARG VITE_API_BASE_URL=/api/v1
RUN npm run build

FROM caddy:2.11.7-alpine
COPY deployment/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /build/frontend-react/dist/ /srv/app/
