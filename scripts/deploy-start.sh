#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT="${DEPLOY_RUN_PORT:-5000}"

echo "Starting static server on port ${PORT}..."
node scripts/serve.js
