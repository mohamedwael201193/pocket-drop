#!/usr/bin/env bash
# Deployed E2E, sized to the 4 QOR deployer cap. A sender needs about 0.56 QOR end to end:
# 0.16 activation + 0.31 deposit (0.1 amount + 0.2 drip + 0.01 fee) + about 0.09 network fees for create and confirm.
set -e
export E2E_FUND=0.57
E2E_VP=m E2E_ONLY=Confirmed npx playwright test --project=chromium e2e/flow.spec.ts
E2E_VP=d E2E_ONLY=Open npx playwright test --project=webkit e2e/flow.spec.ts
