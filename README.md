# Veil

A Chrome extension that uses [Jev](https://docs.typesafe.ai) to hide replies under X / Twitter posts that match a condition you describe in plain language. Vanilla JavaScript, Manifest V3, no build step, no runtime dependencies.

## Install

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Click **Load unpacked** and select this project folder (the one containing `manifest.json`).
3. Click the extension icon, enter your own TypeSafe API key, a filter condition, and a threshold, check **Enable**, and save.
4. Reload any open X tabs and open a post. A badge in the bottom-right corner shows how many replies are currently hidden.

Example condition: *"Product promotion, invitations to investment groups, and scams. Keep normal discussion and replies that quote a scam to warn others."*

Setting changes apply to open tabs within about two seconds, without reloading. Disabling and saving restores all replies. Filtering is local `display: none` only; nothing is deleted or reported on X.

## Behavior and limitations

- Off by default. Only runs in the main column of `/<user>/status/<id>` pages; the main post and the ancestor posts above it are never hidden.
- Replies are identified from the DOM using tweet articles, timestamp permalinks, and the timeline region. Infinite scroll, recycled DOM nodes, and SPA navigation are supported. Filtering stops at a recommendations section when it has a heading. X has no stable DOM contract, so recommended posts without a heading may still be treated as replies, and site redesigns can break detection. Verify on real pages.
- Text only: images, videos, media-only posts, and quoted-post cards are not evaluated. Posts or replies longer than 12,000 characters are kept. Judgments take time, so a reply may appear briefly before being hidden.
- Uses the Noul probability from `jev-latest` and hides a reply only when it reaches the threshold. The default of 0.85 is a starting point that has not been calibrated on a dataset; the model can be wrong. Jev's accuracy is currently best in English, so test your own content if you filter other languages.
- One request per reply. At most 4 requests in flight per tab and 4 across all tabs; identical requests are merged. The background worker caches up to 500 results in memory. The cache is lost when the service worker goes idle, so reloading a page may incur charges again.
- On any API error the reply is kept visible, and errors are handled by type:
  - 429, 529, 5xx, timeouts, network errors: retried up to 3 times using `retry-after` or exponential backoff (about 1 s, then 2 s). If still failing, new requests pause for at least 60 seconds, after which the affected replies are retried automatically.
  - 401 / 403: invalid key. All requests stop until settings are changed.
  - 422, other errors, and malformed responses: only that reply is skipped; other requests continue.
- The API key is stored in `chrome.storage.local`, restricted to the extension's trusted contexts. It is not synced and is never exposed to the content script. This is a bring-your-own-key setup for personal use; extension storage is not a password vault. If you publish this with a shared key, move API calls behind a backend proxy instead.
- Enabling the extension means the main post text, reply text, and your filter condition are sent to TypeSafe. X cookies, account credentials, and page HTML are never sent. API usage may be billed.

## Development

`npm test` runs the API contract and error-handling tests (Node.js 18+). `tests/browser.mjs` is a browser test that requires a local Playwright and Chromium; it uses a mocked X DOM and API and does not consume Jev quota.

Manual acceptance checklist: the main post stays visible; matching replies are hidden; ordinary replies stay visible; scrolling and switching posts work; editing the rules re-evaluates replies; disabling restores everything; an invalid key keeps replies visible and shows an error.

End-to-end verification with a real X account and your own API key is still required. Mocked tests cannot prove real Jev judgment quality or compatibility with X's live DOM.

## References

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [Noul judgments and thresholds](https://docs.typesafe.ai/primitives/noul)
- [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome storage access](https://developer.chrome.com/docs/extensions/reference/api/storage)

## License

[MIT](LICENSE)
