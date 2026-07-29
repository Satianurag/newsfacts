#!/usr/bin/env bash
# Deploy NewsFacts from local machine to Oracle VM (run from repo root).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/oracle-vm.env"

SSH_OPTS=(-i "${ORACLE_SSH_KEY}" -o StrictHostKeyChecking=no)
REMOTE="${ORACLE_VM_USER}@${ORACLE_VM_IP}"
REMOTE_DIR="/home/ubuntu/newsfacts"
PUBLIC_URL="http://${ORACLE_VM_IP}"

echo "==> Sync project to ${REMOTE}:${REMOTE_DIR}"
ssh "${SSH_OPTS[@]}" "${REMOTE}" "mkdir -p ${REMOTE_DIR}"
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules \
  --exclude .git \
  --exclude '*.log' \
  "${REPO_ROOT}/" "${REMOTE}:${REMOTE_DIR}/"

echo "==> Copy .env (production overrides applied on VM)"
scp "${SSH_OPTS[@]}" "${REPO_ROOT}/.env" "${REMOTE}:${REMOTE_DIR}/.env"

echo "==> Run VM setup"
ssh "${SSH_OPTS[@]}" "${REMOTE}" \
  "chmod +x ${REMOTE_DIR}/deploy/setup-oracle-vm.sh && \
   APP_DIR=${REMOTE_DIR} APP_PORT=3002 PUBLIC_URL=${PUBLIC_URL} bash ${REMOTE_DIR}/deploy/setup-oracle-vm.sh"

echo "==> Wait for health"
for i in $(seq 1 30); do
  if curl -sf "${PUBLIC_URL}/health" >/dev/null 2>&1; then
    curl -s "${PUBLIC_URL}/health" | head -c 500
    echo ""
    echo "Deploy OK: ${PUBLIC_URL}"
    exit 0
  fi
  echo "  waiting... ($i)"
  sleep 10
done

echo "Health check failed — check: ssh ${SSH_OPTS[*]} ${REMOTE} sudo journalctl -u newsfacts -n 50"
exit 1
