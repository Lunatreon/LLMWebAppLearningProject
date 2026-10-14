FROM node:24.21.0-alpine AS frontend
WORKDIR /build/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
COPY website/ /build/website/
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_LEGACY_APP_URL=/reference/
ARG VITE_LEGACY_SIGN_IN_URL=/reference/
COPY deployment/configure-reference.mjs /build/configure-reference.mjs
RUN npm run build
RUN node /build/configure-reference.mjs

FROM caddy:2.11.7-alpine
COPY deployment/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /build/frontend-react/dist/ /srv/app/
# The generated reference copy locks its public API configuration; source stays intact.
COPY --from=frontend /build/reference/ /srv/reference/
