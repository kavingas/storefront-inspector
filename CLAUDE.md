# Commerce Events Debugger — CLAUDE.md

## Project Purpose

A Google Chrome DevTools extension that intercepts and validates Adobe Commerce storefront events (MSE SDK) and Product Recommendation events in real time. It captures events from two independent sources and validates context data integrity against required fields.

---

## Chrome Extension — File Map

```
chrome-extension/
├── manifest.json     MV3 manifest — declares scripts, permissions, devtools page
├── devtools.html     Entry point registered as devtools_page; loads devtools.js
├── devtools.js       Registers the "Commerce Events" tab in DevTools
├── panel.html        The DevTools panel UI — loads shared.js then panel.js
├── panel.js          All panel logic: event capture, validation, rendering
├── shared.js         Event registry (EVENT_GROUPS, ALL_EVENTS) + validators
├── injected.js       Runs in MAIN world — patches window.adobeDataLayer
├── content.js        Isolated world bridge — postMessage → chrome.runtime
├── background.js     Service worker — stores events per tab, routes to panel
└── popup.js          Popup view (polls background every 1 s; separate from panel)
```

---

## Event Capture — Two Independent Sources

### Source 1: ACDL (Adobe Client Data Layer)

**How it works:**
1. `injected.js` runs in `MAIN` world at `document_start`
2. It patches `window.adobeDataLayer.push` to intercept calls from the MSE SDK
3. Two interception strategies run in parallel:
   - `window.addEventListener('adobeDataLayer:event', ...)` — ACDL v2 DOM event
   - Proxy wrapping of `acdl.push` — catches the deferred-function pattern the MSE SDK uses
4. Captured events are sent via `window.postMessage` to `content.js`
5. `content.js` (isolated world) receives these and calls `chrome.runtime.sendMessage`
6. `background.js` stores them in `chrome.storage.session` keyed by `tab_<tabId>` and forwards to the panel port

**Filtered events in injected.js** (`TRACKED_EVENTS` set):
`page-view`, `product-page-view`, `add-to-cart`, `place-order`, `recs-unit-view`, `recs-unit-impression-render`, `recs-item-click`, `recs-item-add-to-cart-click`

### Source 2: Snowplow Network Beacons

**Why this was added:** The MSE Snowplow plugin sends events as HTTP beacons to the Snowplow collector — a completely separate channel from ACDL. If ACDL interception fails or fires after the beacon, this source catches them.

**How it works (entirely within `panel.js`):**
1. `chrome.devtools.network.getHAR()` — seeds from requests already in the Network panel when DevTools opens
2. `chrome.devtools.network.onRequestFinished` listener — real-time capture for new requests
3. `SP_URL_PATTERN` regex matches both GET (`/i?tv=`) and POST (`/tp2`) Snowplow endpoints
4. For GET requests: params read from URL search params
5. For POST requests: body parsed as `payload_data` JSON (`{ schema: "iglu:.../payload_data/...", data: [...] }`)
6. `ue_px` field (base64url) → decoded → parsed as self-describing event → event name extracted from schema URI path segment
7. `cx` field (base64url) → decoded → parsed as contexts array → each entity mapped to `eventInfo` by converting kebab-case schema name to camelCase key (e.g. `product-context` → `productContext`)
8. Results pushed into `networkEvents[]` array (kept separate from `allEvents[]` to avoid overwrite race condition with `GET_EVENTS` response)

**No extra permissions are needed.** `chrome.devtools.network` is available in all DevTools page contexts without a manifest permission.

---

## State in `panel.js`

| Variable | Source | Cleared by |
|---|---|---|
| `allEvents[]` | Background (ACDL path) | `EVENTS_CLEARED` port msg, Clear button, `GET_EVENTS` response overwrites |
| `networkEvents[]` | Snowplow network capture | `EVENTS_CLEARED` port msg, Clear button |

`buildEventMap()` merges both arrays into a `Map<eventName, occurrence[]>` that drives all rendering.

`hasAnyEvents()` — helper used in empty-state checks throughout render functions.

---

## Event Payload Shape

```js
{
  event: 'product-page-view',   // matches acdlEvent in shared.js
  eventInfo: {                  // context objects keyed by camelCase name
    pageContext: { pageType: 'product', ... },
    storefrontInstanceContext: { environmentId: '...', storeUrl: '...', ... },
    productContext: { productId: 123, name: '...', sku: '...', pricing: { ... } }
  },
  timestamp: 1714000000000,
  url: 'https://store.example.com/product.html',
  source: 'snowplow'            // present only on network-captured events
}
```

---

## Event Registry (`shared.js`)

`EVENT_GROUPS` defines the two display groups and their required contexts:

| Event label | `acdlEvent` key | Required contexts |
|---|---|---|
| Page View | `page-view` | pageContext, storefrontInstanceContext |
| Product View | `product-page-view` | + productContext |
| Add to Cart | `add-to-cart` | + shoppingCartContext, changedProductsContext |
| Place Order | `place-order` | + shoppingCartContext, orderContext |
| Unit Render | `recs-unit-impression-render` | pageContext, storefrontInstanceContext, recommendationsContext |
| Unit View | `recs-unit-view` | same |
| Item Click | `recs-item-click` | same |
| Add to Cart Click | `recs-item-add-to-cart-click` | same |

`CONTEXT_VALIDATORS` maps each context key to required fields and optional `check()` functions:
- `productContext` — requires `pricing.regularPrice` and `pricing.currencyCode`
- `shoppingCartContext` — requires non-empty `items[]`
- `changedProductsContext` — validates each `items[i].product` and `items[i].quantity`
- `recommendationsContext` — validates each `units[i]` for `unitId`, `unitName`, `typeId`, non-empty `products[]`

---

## Background Service Worker (`background.js`)

- Storage: `chrome.storage.session`, key `tab_events_<tabId>`
- One DevTools port per tab stored in `devtoolsPorts` Map
- Tab navigation (`tabs.onUpdated` with `status === 'loading'`) auto-clears events and sends `EVENTS_CLEARED` to panel
- Badge text = count of unique event names seen on the tab

**Message types:**

| Type | Direction | Purpose |
|---|---|---|
| `EVENT_CAPTURED` | content.js → background | Store ACDL event, forward to panel |
| `GET_EVENTS` | panel → background | Load stored events on panel init |
| `CLEAR_EVENTS` | panel → background | Clear storage + badge |
| `EVENTS_CLEARED` | background → panel (port) | Panel resets both arrays |
| `EVENT_CAPTURED` | background → panel (port) | Panel appends to `allEvents` |
| `INIT` | panel → background (port) | Register panel port for tab |

---

## How to Load the Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `chrome-extension/` directory
4. Open DevTools on any page → **Commerce Events** tab appears
5. After editing any file: click the reload icon on the extension card, then close/reopen DevTools

The extension requires no build step — all files are plain JS loaded directly.

---

## Key Design Decisions

- **No build toolchain** — plain JS/HTML/CSS only, zero dependencies, load-unpacked development
- **MAIN-world injection** — required to access `window.adobeDataLayer` before page scripts run
- **Dual capture** — ACDL and Snowplow network capture run independently; same event may appear from both if both channels are active
- **Separate `networkEvents` array** — avoids a race condition: the `GET_EVENTS` response from background overwrites `allEvents` on init; Snowplow events stored separately survive this
- **No webRequest permission** — network capture uses `chrome.devtools.network` which is permission-free and provides full POST bodies; `webRequest` cannot read POST bodies in MV3
- **Session storage** — ACDL events persist across panel close/reopen within the same browser session but clear on tab navigation

---

## Snowplow Payload Decoding Reference

```
ue_px  → base64url → JSON → { schema: "iglu:...unstruct_event...", data: { schema: "iglu:vendor/event-name/...", data: {...} } }
                                                                           ^^^^^^^^^^^^ event name is path segment [1]

cx     → base64url → JSON → { schema: "iglu:...contexts...", data: [ { schema: "iglu:vendor/context-name/...", data: {...} } ] }
                                                                              ^^^^^^^^^^^^ camelCase this to get eventInfo key
```

`b64Decode` replaces `-`→`+` and `_`→`/` before `atob()` to handle URL-safe base64.
`schemaNameToKey` splits on `/`, takes index `[1]`, converts kebab-case to camelCase.
