# README assets

Images used by the repository README. Nothing here is mocked: every screenshot is the live app.

| File | What | How it was made |
|---|---|---|
| `logo-mark.svg` | The Pocket Drop mark: emerald hexagon (the Pocket) holding a white droplet (the drop) | Same paths and gradient as `frontend/src/components/logo.tsx` |
| `logo-dark.svg`, `logo-light.svg` | Mark and wordmark, for dark and light backgrounds | Mark as above; wordmark is "Pocket Drop" in Funnel Display 600 (`frontend/public/fonts`), converted to outlines so it renders without the font |
| `banner-dark.png`, `banner-light.png` | README banner, 2560x800 (1280x400 at 2x) | HTML in the landing's colours and fonts, rendered with headless Chromium. The hexagon is drawn as on the landing hero: each cell is one byte of the real 4,627-byte ML-DSA-87 signature in `frontend/src/landing/data/signature.json` (RECORDED, from `contracts-v4/test/fixtures/pool/claim_2_1.json`) |
| `social-preview.png` | 1280x640 image for the GitHub social preview (repository Settings, Social preview) | Same as the banner |
| `screens/*.png`, `screens/landing.webp` | Screenshots of https://pocket-drop.vercel.app | Headless Chromium (Playwright), 2x device pixel ratio, desktop 1440x900 and mobile 390x844, taken 26 Nov 2026 from a fresh browser with no key and no Pocket. No transaction was sent to take them. LIVE values (block height, balances, slots left) are as they were at that moment |

Screens: `landing` (hero), `app` (overview), `send`, `receive`, `pool` (the claim screen of the team-hosted sample pool, before taking a slot), `pocket` (no key yet), `proof`, `judges`, `judges-req` (a track requirement with code, live transactions and tests), `judges-delta` (the measured delta and the cost table), `qday-baits` (the five bait Pockets with their published classical keys), `qday-refused` (refused attempts), `check` (a refused Q-Day attack re-verified in the browser), `radar`; mobile: `landing-m`, `send-m`, `receive-m`, `pool-m`.
