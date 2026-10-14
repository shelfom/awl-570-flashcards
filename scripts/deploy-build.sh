#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH:-$(pwd)}"

echo "Installing dependencies..."
pnpm install

echo "Building with Vite..."
pnpm exec vite build

echo "Build completed successfully!"
