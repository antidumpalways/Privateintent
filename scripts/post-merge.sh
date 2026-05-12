#!/bin/bash
set -e
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --frozen-lockfile
pnpm --filter db push
