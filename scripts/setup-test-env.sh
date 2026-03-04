#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[setup-test-env] $*"
}

warn() {
  echo "[setup-test-env][AVISO] $*" >&2
}

fail() {
  echo "[setup-test-env][ERRO] $*" >&2
  exit 1
}

REGISTRY_URL="${NPM_REGISTRY_URL:-https://registry.npmjs.org/}"
REQUIRE_AUTH="${NPM_REQUIRE_AUTH:-false}"
ALLOW_PING_FAILURE="${NPM_ALLOW_PING_FAILURE:-true}"

[[ -n "${REGISTRY_URL}" ]] || fail "NPM_REGISTRY_URL está vazio. Defina um registry válido."

log "Node: $(node -v)"
log "npm: $(npm -v)"
log "Registry solicitado: ${REGISTRY_URL}"

npm config set registry "${REGISTRY_URL}"
EFFECTIVE_REGISTRY="$(npm config get registry)"
[[ -n "${EFFECTIVE_REGISTRY}" ]] || fail "Não foi possível determinar o registry npm efetivo."

log "Registry efetivo: ${EFFECTIVE_REGISTRY}"

if [[ "${REQUIRE_AUTH}" == "true" ]]; then
  [[ -n "${NPM_TOKEN:-}" ]] || fail "NPM_REQUIRE_AUTH=true, mas NPM_TOKEN não foi definido."
  log "Autenticação obrigatória habilitada. Validando token no registry..."
  npm whoami --registry "${EFFECTIVE_REGISTRY}" >/dev/null \
    || fail "Falha na autenticação npm (npm whoami). Verifique NPM_TOKEN e permissões do registry."
  log "Autenticação npm validada com sucesso."
else
  log "Autenticação opcional (NPM_REQUIRE_AUTH=false)."
fi

log "Testando conectividade com o registry (npm ping)..."
if ! npm ping --registry "${EFFECTIVE_REGISTRY}"; then
  if [[ "${ALLOW_PING_FAILURE}" == "true" ]]; then
    warn "npm ping falhou, mas o script vai continuar (NPM_ALLOW_PING_FAILURE=true)."
  else
    fail "Falha no npm ping para ${EFFECTIVE_REGISTRY}. Defina NPM_ALLOW_PING_FAILURE=true para tentar mesmo assim."
  fi
fi

log "Tentando instalar dependências com npm ci --verbose"
if npm ci --verbose; then
  log "Dependências instaladas com sucesso."
  log "Nenhum teste/build pesado será executado automaticamente."
  log "Para validação leve, execute: npm run check:lite"
  log "Para validação completa, execute manualmente: npm run test"
  exit 0
fi

warn "A instalação falhou (possível restrição de rede/registry)."
warn "Troubleshooting sugerido:"
warn "1) Verifique proxy/firewall corporativo e allowlist para ${EFFECTIVE_REGISTRY}"
warn "2) Se usar registry privado: exporte NPM_REGISTRY_URL e, se necessário, NPM_REQUIRE_AUTH=true + NPM_TOKEN"
warn "3) Rode: npm run debug:npm-config"

log "Executando fallback de validação estática sem dependências (npm run check:lite)..."
npm run check:lite
