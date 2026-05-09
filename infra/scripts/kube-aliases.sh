#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Kubectl aliases for FS Suite — source this in your shell
#
#   source infra/scripts/kube-aliases.sh
#
# Commands:
#   kprod get pods   →  kubectl --context fs-suite-prod -n fs-suite get pods
# ──────────────────────────────────────────────────────────────

CTX_PROD="fs-suite-prod"
NS="fs-suite"

kprod() {
  echo -e "\033[31m[PROD]\033[0m kubectl $*"
  kubectl --context "$CTX_PROD" -n "$NS" "$@"
}

echo "FS Suite kubectl aliases loaded:"
echo "  kprod <cmd>  — run against production cluster"
