# vnext-local-manager: Multi-stage build
# Stage 1: Build (npm, helm, kubectl burada; final image'da yok = CVE yok)
# Node 20 EOL (CVE-2026-111497 için fix yok) → Node 24 LTS, sabit sürüm (Twistlock taraması tekrarlanabilir olsun)
ARG NODE_IMAGE=node:24.22.2-alpine3.23
FROM ${NODE_IMAGE} AS builder

RUN apk add --no-cache curl bash && apk upgrade --no-cache && rm -rf /var/cache/apk/* /tmp/* /root/.npm 2>/dev/null || true

# Helm + kubectl (TARGETARCH = amd64 | arm64)
# helm v3.22.1: Go 1.26.9 + oras-go 2.6.2 + x/net 0.60 (v3.20.0'daki Go stdlib/grpc/oras/containerd CVE'leri yok)
ARG TARGETARCH
ARG HELM_VERSION=v3.22.1
# İndirilen binary'ler sha256 ile doğrulanır (bozuk/değiştirilmiş indirme build'i durdurur)
RUN cd /tmp && \
    curl -fsSLO "https://get.helm.sh/helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" && \
    curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz.sha256sum" | sha256sum -c - && \
    tar xzf "helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" && \
    mv /tmp/linux-${TARGETARCH}/helm /usr/local/bin/helm && rm -rf /tmp/linux-* /tmp/helm-* && \
    KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)" && \
    curl -fsSLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" && \
    echo "$(curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl.sha256")  kubectl" | sha256sum -c - && \
    chmod +x kubectl && mv kubectl /usr/local/bin/

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY template_values.yaml ./
COPY infra_values.yaml ./


COPY viewer/package.json viewer/package-lock.json* viewer/
RUN cd viewer && npm ci
COPY viewer ./viewer
RUN cd viewer && npm run build

# Stage 2: Runtime – Alpine; npm kaldırılıyor (sadece node server.js çalıyor → 11 npm bundle CVE yok)
FROM ${NODE_IMAGE}

RUN apk upgrade --no-cache && rm -rf /var/cache/apk/* /tmp/* /usr/local/lib/node_modules/npm

ENV PORT=3000
ENV HOME=/tmp
ENV NODE_ENV=production
ENV PATH="/app/bin:${PATH}"

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js /app/infra_values.yaml /app/template_values.yaml ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/viewer/dist ./viewer/dist
COPY --from=builder /app/package.json ./
COPY --from=builder /usr/local/bin/helm /usr/local/bin/kubectl /app/bin/

# data dizini yazılabilir olsun (chart tag cache, app-config); aksi halde cache hiç kalıcı olmuyor.
# Grup 0 + g=u: OpenShift rastgele UID'yi root grubuyla çalıştırır.
RUN mkdir -p /app/data && chown 1000:0 /app/data && chmod g=u /app/data

EXPOSE 3000
# Sayısal UID: k8s runAsNonRoot doğrulayabilsin (OpenShift SCC kendi UID'sini atar)
USER 1000
CMD ["node", "server.js"]
