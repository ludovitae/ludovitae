# Ludovitae container image (podman-first). Build:
#
#   podman build --format docker -t ludovitae .
#
# Multi-stage: UBI9 Node.js builds the frontend, UBI9 Python 3.12 runs the
# server and serves the built SPA (see server/src/gol/main.py `_mount_spa`).
# `--format docker` matters: HEALTHCHECK is not representable in the OCI
# image format and podman silently drops it otherwise (the CI workflow
# keeps it via `oci: false` in .github/workflows/container.yml).

# --- Stage 1: build web/ ----------------------------------------------------
FROM registry.access.redhat.com/ubi9/nodejs-22:9.8 AS web-build

# UBI s2i images run as uid 1001 with workdir /opt/app-root/src.
COPY --chown=1001:0 web/package.json web/package-lock.json ./
RUN npm ci
COPY --chown=1001:0 web/ ./
RUN npm run build

# --- Stage 2: runtime -------------------------------------------------------
FROM registry.access.redhat.com/ubi9/python-312:9.8

LABEL org.opencontainers.image.title="Ludovitae" \
      org.opencontainers.image.description="Personal financial life simulator (API + web UI)" \
      org.opencontainers.image.source="https://github.com/ludovitae/ludovitae" \
      org.opencontainers.image.licenses="MIT"

# Install the server package (and its dependencies) into the image's
# virtualenv (/opt/app-root, owned by uid 1001 — no root needed).
COPY --chown=1001:0 server/ /tmp/build/server/
RUN pip install --no-cache-dir /tmp/build/server && rm -rf /tmp/build

# Built SPA from stage 1; served by the API process via GOL_WEB_DIST.
COPY --chown=1001:0 --from=web-build /opt/app-root/src/dist /opt/app-root/web/dist

ENV GOL_WEB_DIST=/opt/app-root/web/dist \
    GOL_DATA_DIR=/data

# /data holds everything mutable: SQLite DB, backups, TLS key+cert.
# Owned by the UBI non-root default uid 1001 (group 0, OpenShift convention).
# A named volume (`-v ludovitae-data:/data`) inherits this ownership via
# podman's copy-up. For a host-directory bind mount use `:Z,U` so podman
# relabels (SELinux) and chowns it to the container user, e.g.
# `-v ./data:/data:Z,U`.
USER 0
RUN mkdir -p /data && chown 1001:0 /data && chmod 0770 /data
USER 1001
VOLUME /data

# 8443: default HTTPS (gol-serve on a non-loopback bind auto-generates a
# self-signed cert into /data/tls on first run). 8000 is exposed for users
# who run plain HTTP behind their own reverse proxy / TLS terminator.
EXPOSE 8443 8000

# Session endpoint answers 200 without auth. -k: the cert is self-signed.
# The fallback covers running plain HTTP on 8000 behind a reverse proxy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fks https://127.0.0.1:8443/api/v1/auth/session \
        || curl -fs http://127.0.0.1:8000/api/v1/auth/session \
        || exit 1

CMD ["gol-serve", "--host", "0.0.0.0"]
