# Commerce Events Debugger

A Google Chrome DevTools extension for inspecting and validating Adobe Commerce storefront events (MSE SDK) and Product Recommendations events in real time.

## What it does

The extension captures events from two independent sources and validates the context data attached to each event against required fields, surfacing missing or malformed data directly in DevTools.

**Captured event groups:**

| Group | Events |
|---|---|
| Adobe Commerce Events | Page View, Product View, Add to Cart, Place Order |
| Recommendations Events | Unit Render, Unit View, Item Click, Add to Cart Click |

## How it works

### Source 1 — Adobe Client Data Layer (ACDL)

`injected.js` runs in the `MAIN` world at `document_start` and patches `window.adobeDataLayer.push` before any page script runs. Intercepted events travel through:

```
injected.js (MAIN world)
  → window.postMessage
  → content.js (isolated world)
  → chrome.runtime.sendMessage
  → background.js (service worker, stores per-tab)
  → panel port → panel.js
```

### Source 2 — Snowplow Network Beacons

`panel.js` monitors the DevTools Network panel for HTTP beacons sent by the MSE Snowplow plugin. Both existing HAR entries (on DevTools open) and new requests (via `onRequestFinished`) are captured and decoded:

- `ue_px` field (base64url) → event name extracted from schema URI
- `cx` field (base64url) → context entities mapped to `eventInfo` keys

No extra manifest permissions are required — `chrome.devtools.network` is available in all DevTools contexts.

### Validation

Each event is validated against its required contexts (`pageContext`, `storefrontInstanceContext`, `productContext`, etc.). Missing fields and structural issues are highlighted inline in the panel.

## Installation

No build step is required. All files are plain JS/HTML/CSS.

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked** and select this directory
4. Open DevTools on any Adobe Commerce storefront page
5. Select the **Commerce Events** tab

After editing any file, click the reload icon on the extension card in `chrome://extensions`, then close and reopen DevTools.

## File map

```
├── manifest.json     MV3 manifest — scripts, permissions, devtools page
├── devtools.html     Entry point registered as devtools_page
├── devtools.js       Registers the "Commerce Events" tab in DevTools
├── panel.html        DevTools panel UI
├── panel.js          Event capture, validation, and rendering
├── shared.js         Event registry (EVENT_GROUPS) and context validators
├── injected.js       MAIN-world script — patches window.adobeDataLayer
├── content.js        Isolated-world bridge — postMessage → chrome.runtime
├── background.js     Service worker — stores events per tab, routes to panel
├── popup.html        Toolbar popup
└── popup.js          Popup view (polls background every 1 s)
```

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Persists events in `chrome.storage.session` keyed by tab |
| `tabs` | Reads tab ID to scope stored events |

## Context validators

| Context | Required fields |
|---|---|
| `pageContext` | `pageType` |
| `storefrontInstanceContext` | `environmentId`, `environment`, `storeUrl`, `baseCurrencyCode`, `storeViewCurrencyCode` |
| `productContext` | `name`, `sku`, `pricing.regularPrice`, `pricing.currencyCode` |
| `shoppingCartContext` | `id` (or `cartId`), `totalQuantity` (or `itemsCount`), non-empty `items[]` |
| `orderContext` | `orderId` |
| `changedProductsContext` | non-empty `items[]` with `product` and `quantity` per item |
| `recommendationsContext` | non-empty `units[]` with `unitId`, `unitName`, `typeId`, and products per unit |

## Notes

- Events persist across page navigations within the same browser session and survive panel close/reopen. They are cleared only when the user clicks **Clear** or closes the tab.
- The same event may appear from both ACDL and Snowplow sources if both channels are active — this is expected and intentional.
- ACDL events are stored in `allEvents[]`; Snowplow events in a separate `networkEvents[]` to avoid a race condition with the `GET_EVENTS` init response overwriting `allEvents`.
