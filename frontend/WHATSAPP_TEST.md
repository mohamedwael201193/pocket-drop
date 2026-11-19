# WhatsApp test

> Testnet only. Diana, no monetary value.

Goal: prove that a Pocket Drop link survives WhatsApp. The claim key lives in the `#fragment` of the URL (`/c/<id>#k=<64 hex>`), so the question is whether WhatsApp keeps the whole URL, fragment included, and whether the link preview needs it (it must not).

## (a) Automated checks

Run: `npx vitest run test/whatsapp.test.ts` and `E2E_URL=https://pocketdrop-app.vercel.app npx playwright test e2e/privacy.spec.ts`. Results of the last run are in `evidence/vitest.txt`, `evidence/privacy-chromium.json`, `evidence/privacy-webkit.json`.

| Check | Result |
|---|---|
| The "Send on WhatsApp" button is `https://wa.me/?text=<encodeURIComponent(message + " " + link)>`; the raw `#` and spaces are percent-encoded (`%23k%3D`) | pass |
| `decodeURIComponent` of the `text` parameter returns exactly `<message> <link>`, including the full fragment | pass |
| The seed recovered from the decoded text equals the original 32-byte seed, bit-exact | pass |
| The link is one ASCII line under 200 characters (no wrapping, no truncation) | pass |
| A plain HTTP client (what a link-preview crawler uses) asks the server for `/c/42` and never sends the fragment | pass |
| E2E, deployed app: the rendered "Send on WhatsApp" href decodes to the exact claim URL created in that run (Chromium and WebKit, Confirmed and Open) | pass |
| E2E, deployed app: opening `/c/1#k=<random seed>` in a real browser, none of the 15 requests or Referer headers contains the seed or `#k=` | pass |

### Link preview (`og:` tags)

The preview crawler requests `/c/<id>` without a fragment and reads the static HTML. The app serves the same `index.html` for every route, with:

- `og:title`: "Someone sent you QOR with Pocket Drop"
- `og:description`: "Open the link to receive testnet QOR. No wallet, no extension, no seed phrase. Testnet only, no monetary value."
- `og:image`: `https://pocketdrop-app.vercel.app/og.png` (1200x630 PNG, reachable, `content-type: image/png`, 522,547 bytes)
- `twitter:card`: `summary_large_image`

The preview is generic by design: it does not show the amount, the sender or the key, because none of that is available to a server. It needs nothing from the fragment. What I verified is the tags and that the image is reachable; I could not render WhatsApp's own preview from here, so look at it in step 3 below.

## (b) A real unclaimed link for you to send yourself

One Confirmed-mode link with **0.3 QOR**, created through the deployed app and not claimed. The link contains the claim key, so it is not committed to the repository. It is printed in the hand-off report, and also saved locally in `evidence/e2e-secrets-whatsapp.json` (git-ignored) together with the sender account's backup key.

- App: https://pocketdrop-app.vercel.app
- Link number: 17
- Sender account: `0x8f9afD1d5419B4aC0A2f281B2c7E0bCA0c4bB32D` (funded 1.1 QOR by the test deployer, key registered and window opened; fund tx `0x73b0a7f8a7da0f9138cec06aff32db0db0aa26c030373460566bed78252444dc`, create tx `0x03aa1632a2cebfa7fc0392494d42a8e26b2648fb3f7b56032570a104f0c0dc51`)
- The link is valid for 24 hours. The sender's authorisation window lasts roughly 7 hours; if the app asks you to activate the account again, press the button (about 0.16 QOR, the account has enough).

## (c) Steps for you

1. **Send the link to yourself on WhatsApp.** Open the link from the report and paste it into "Message yourself" (or any chat with yourself) in WhatsApp on your computer or phone. Screenshot 1: the chat with the link bubble and its preview card.
2. **Check the fragment survived.** Long-press the bubble, copy the link, and compare it with the original: it must end in the same `#k=` plus 64 characters.
3. **Open it on your Android phone.** Tap the link in WhatsApp on the phone (it opens your browser). Screenshot 2: the page showing "You received a Pocket Drop, 0.3 QOR". Tap **Receive 0.3 QOR**.
4. **Wait for the four words.** The steps tick through account, bind, register and window, then four words appear and the page says it is waiting for the sender. Screenshot 3: the four words.
5. **Sender confirm.** On any other browser (your laptop), open https://pocketdrop-app.vercel.app, open "I already have a backup key", paste `senderBackupKey` from `evidence/e2e-secrets-whatsapp.json`, press Restore. Under "Your links" open "Track a link made with this account elsewhere", enter `17`, press Track. The same four words appear; compare them with your phone. If identical, press **The words match, confirm**. Screenshot 4: the sender confirm panel with the words next to the phone.
6. **Claim.** Within a few seconds the phone claims by itself. Screenshot 5: "It is yours." with the balance (about 0.29 QOR: 0.3 plus the leftover gas drip) and the claim transaction link.
7. Optional: open the claim transaction in the explorer from the phone page.

What to send back: screenshots 1 to 5, and tell me whether the WhatsApp preview card showed the image and title. If step 3 shows "This link is missing its key", WhatsApp cut the fragment: copy the exact bubble text and send it.
