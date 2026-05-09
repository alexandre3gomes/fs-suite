#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configures kubectl to access the production K8s cluster
# on the OCI VM, as a separate context named "fs-suite-prod".
#
# Usage:
#   ./infra/scripts/setup-prod-kubeconfig.sh <user@vm-ip>
#
# Example:
#   ./infra/scripts/setup-prod-kubeconfig.sh ubuntu@140.238.1.100
# ──────────────────────────────────────────────────────────────

CONTEXT_NAME="fs-suite-prod"
CLUSTER_NAME="fs-suite-prod"
USER_NAME="fs-suite-prod-admin"
KUBECONFIG_FILE="${HOME}/.kube/config-fssuite-prod"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user@vm-ip-or-hostname>"
  echo "Example: $0 ubuntu@140.238.1.100"
  exit 1
fi

VM_SSH="$1"

echo "── Fetching kubeconfig from ${VM_SSH}..."
REMOTE_CONFIG=$(ssh "$VM_SSH" "cat ~/.kube/config")

if [[ -z "$REMOTE_CONFIG" ]]; then
  echo "Error: empty kubeconfig from remote" >&2
  exit 1
fi

# Extract server address from remote config
REMOTE_SERVER=$(echo "$REMOTE_CONFIG" | grep -m1 "server:" | awk '{print $2}')
echo "   Remote server: ${REMOTE_SERVER}"

# Ask for the public endpoint if server is localhost/127.0.0.1
if echo "$REMOTE_SERVER" | grep -qE '127\.0\.0\.1|localhost'; then
  VM_HOST=$(echo "$VM_SSH" | cut -d'@' -f2)
  REMOTE_PORT=$(echo "$REMOTE_SERVER" | grep -oE ':[0-9]+$' | tr -d ':')
  REMOTE_PORT="${REMOTE_PORT:-6443}"

  read -rp "   Server is localhost — use https://${VM_HOST}:${REMOTE_PORT}? [Y/n] " yn
  if [[ "${yn,,}" != "n" ]]; then
    PUBLIC_SERVER="https://${VM_HOST}:${REMOTE_PORT}"
  else
    read -rp "   Enter public API server URL: " PUBLIC_SERVER
  fi
else
  PUBLIC_SERVER="$REMOTE_SERVER"
fi

# Write to separate kubeconfig file
echo "$REMOTE_CONFIG" | sed "s|${REMOTE_SERVER}|${PUBLIC_SERVER}|g" > "$KUBECONFIG_FILE"
chmod 600 "$KUBECONFIG_FILE"
echo "   Saved to ${KUBECONFIG_FILE}"

# Merge into main kubeconfig as a named context
export KUBECONFIG="${HOME}/.kube/config:${KUBECONFIG_FILE}"

# Rename the imported entries to our standard names
IMPORTED_CLUSTER=$(kubectl config view --flatten -o jsonpath='{.clusters[*].name}' | tr ' ' '\n' | grep -v "$CLUSTER_NAME" | tail -1)
IMPORTED_USER=$(kubectl config view --flatten -o jsonpath='{.users[*].name}' | tr ' ' '\n' | grep -v "$USER_NAME" | tail -1)

kubectl config set-context "$CONTEXT_NAME" \
  --cluster="$IMPORTED_CLUSTER" \
  --user="$IMPORTED_USER" \
  --namespace=fs-suite \
  > /dev/null

# Flatten to single config
kubectl config view --flatten > "${HOME}/.kube/config.tmp"
mv "${HOME}/.kube/config.tmp" "${HOME}/.kube/config"
chmod 600 "${HOME}/.kube/config"
rm -f "$KUBECONFIG_FILE"
unset KUBECONFIG

echo ""
echo "── Contexts available:"
kubectl config get-contexts -o name
echo ""
echo "── Testing connection to ${CONTEXT_NAME}..."
if kubectl --context="$CONTEXT_NAME" cluster-info 2>/dev/null | head -1; then
  echo "   ✓ Connected"
else
  echo "   ✗ Could not connect. Check:"
  echo "     - Port 6443 open in OCI Security List (for your IP only)"
  echo "     - Firewall rules on the VM"
fi

echo ""
echo "Done. Use:"
echo "  kubectl --context k3d-fs-suite ...      # local"
echo "  kubectl --context fs-suite-prod ...     # production"
echo ""
echo "Or source the helper aliases:"
echo "  source infra/scripts/kube-aliases.sh"
