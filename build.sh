#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="openclaw-sandbox-browser:bookworm-slim"

docker build -t "${IMAGE_NAME}" .
echo "Built ${IMAGE_NAME}"