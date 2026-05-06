'use strict';

// EVENT_GROUPS, ALL_EVENTS, CONTEXT_VALIDATORS, validateContext, validateEvent
// are provided by shared.js, loaded before this script.

// ── State ────────────────────────────────────────────────────────────────────

let allEvents = [];       // ACDL events forwarded from background service worker
let networkEvents = [];   // Snowplow beacon events captured via chrome.devtools.network
let selectedEventId = null;
let selectedOccurrenceIndex = {};

// ── Background connection ────────────────────────────────────────────────────

const tabId = chrome.devtools.inspectedWindow.tabId;

const installedVersion = chrome.runtime.getManifest().version;
document.getElementById('versionBadge').textContent = 'v' + installedVersion;

(function checkForUpdate() {
    fetch('https://api.github.com/repos/kavingas/storefront-inspector/releases/latest')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || !data.tag_name) return;
            const latest = data.tag_name.replace(/^v/, '');
            const toNum = v => v.split('.').map(Number);
            const [la, lb, lc] = toNum(latest);
            const [ia, ib, ic] = toNum(installedVersion);
            const isOlder = la > ia || (la === ia && lb > ib) || (la === ia && lb === ib && lc > ic);
            if (!isOlder) return;
            const banner = document.getElementById('updateBanner');
            document.getElementById('updateBannerMsg').innerHTML =
                `A newer version <strong>v${latest}</strong> is available. — <a href="${data.html_url}" target="_blank">Download</a>`;
            banner.style.display = 'flex';
            document.getElementById('updateBannerDismiss').addEventListener('click', () => {
                banner.style.display = 'none';
            });
        })
        .catch(() => {});
})();

const port = chrome.runtime.connect({ name: 'devtools-panel' });
port.postMessage({ type: 'INIT', tabId });

port.onMessage.addListener(msg => {
    if (msg.type === 'EVENT_CAPTURED') {
        allEvents.push(msg.payload);
        render();
    }
    if (msg.type === 'EVENTS_CLEARED') {
        allEvents = [];
        networkEvents = [];
        selectedOccurrenceIndex = {};
        selectedEventId = null;
        render();
    }
});

chrome.runtime.sendMessage({ type: 'GET_EVENTS', tabId }, response => {
    allEvents = response?.events || [];
    render();
});

// ── UI helpers ───────────────────────────────────────────────────────────────

function statusClass(occurrences, eventConfig) {
    if (occurrences.length === 0) return 'not-fired';
    const { hasIssues } = validateEvent(eventConfig, occurrences[occurrences.length - 1].eventInfo || {});
    return hasIssues ? 'issues' : 'ok';
}

function buildEventMap() {
    const map = new Map();
    for (const ev of [...allEvents, ...networkEvents]) {
        if (!map.has(ev.event)) map.set(ev.event, []);
        map.get(ev.event).push(ev);
    }
    return map;
}

function hasAnyEvents() {
    return allEvents.length > 0 || networkEvents.length > 0;
}

function flattenContext(obj, prefix) {
    if (!obj || typeof obj !== 'object') return [];
    const rows = [];
    for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (Array.isArray(v)) {
            if (v.length === 0) {
                rows.push([fullKey, '[]']);
            } else if (v.every(item => item === null || typeof item !== 'object')) {
                rows.push([fullKey, v.map(item => item == null ? '—' : String(item)).join(', ')]);
            } else {
                v.forEach((item, i) => {
                    if (item !== null && typeof item === 'object') {
                        rows.push(...flattenContext(item, `${fullKey}[${i}]`));
                    } else {
                        rows.push([`${fullKey}[${i}]`, item == null ? '—' : String(item)]);
                    }
                });
            }
        } else if (v !== null && typeof v === 'object') {
            rows.push(...flattenContext(v, fullKey));
        } else {
            rows.push([fullKey, v == null ? '—' : String(v)]);
        }
    }
    return rows;
}

// ── Sidebar rendering ────────────────────────────────────────────────────────

function renderSidebar(eventMap) {
    const container = document.getElementById('sidebarScroll');
    container.innerHTML = '';

    for (const group of EVENT_GROUPS) {
        const header = document.createElement('div');
        header.className = 'group-header';
        header.textContent = group.group;
        container.appendChild(header);

        for (const ec of group.events) {
            const occs = eventMap.get(ec.acdlEvent) || [];
            const sc   = statusClass(occs, ec);

            const item = document.createElement('div');
            item.className = 'event-item' + (selectedEventId === ec.id ? ' active' : '');
            item.dataset.id = ec.id;

            const dot = document.createElement('div');
            dot.className = `status-dot ${sc}`;

            const text = document.createElement('div');
            text.style.flex = '1';
            text.style.overflow = 'hidden';

            const label = document.createElement('div');
            label.className = 'event-label';
            label.textContent = ec.label;

            const acdl = document.createElement('div');
            acdl.className = 'event-acdl';
            acdl.textContent = ec.acdlEvent;

            text.appendChild(label);
            text.appendChild(acdl);
            item.appendChild(dot);
            item.appendChild(text);

            if (occs.length > 0) {
                const badge = document.createElement('span');
                badge.className = 'count-badge';
                badge.textContent = occs.length;
                item.appendChild(badge);
            }

            item.addEventListener('click', () => {
                selectedEventId = ec.id;
                render();
            });

            container.appendChild(item);
        }
    }
}

// ── Main detail panel ────────────────────────────────────────────────────────

function renderMain(eventMap) {
    const panel = document.getElementById('mainPanel');
    panel.innerHTML = '';

    if (!hasAnyEvents()) {
        const empty = document.createElement('div');
        empty.className = 'main-empty';
        empty.innerHTML = '<div class="icon">&#128269;</div><div class="msg">Navigate an Adobe Commerce storefront page<br>to start capturing events.</div>';
        panel.appendChild(empty);
        return;
    }

    const ec = ALL_EVENTS.find(e => e.id === selectedEventId);
    if (!ec) {
        const empty = document.createElement('div');
        empty.className = 'main-empty';
        empty.innerHTML = '<div class="icon">&#128196;</div><div class="msg">Select an event from the list<br>to see its details.</div>';
        panel.appendChild(empty);
        return;
    }

    const occs  = eventMap.get(ec.acdlEvent) || [];
    const fired  = occs.length > 0;
    const sc     = statusClass(occs, ec);

    const dh = document.createElement('div');
    dh.className = 'detail-header';

    const dhDot = document.createElement('div');
    dhDot.className = `detail-dot status-dot ${sc}`;

    const dhBlock = document.createElement('div');
    dhBlock.className = 'detail-title-block';

    const dhTitle = document.createElement('div');
    dhTitle.className = 'detail-title';
    dhTitle.textContent = ec.label;

    const dhAcdl = document.createElement('div');
    dhAcdl.className = 'detail-acdl';
    dhAcdl.textContent = `ACDL event: ${ec.acdlEvent}`;

    dhBlock.appendChild(dhTitle);
    dhBlock.appendChild(dhAcdl);
    dh.appendChild(dhDot);
    dh.appendChild(dhBlock);
    panel.appendChild(dh);

    if (!fired) {
        const scroll = document.createElement('div');
        scroll.className = 'detail-scroll';
        const card = document.createElement('div');
        card.className = 'not-fired-card';
        card.textContent = 'This event has not been captured on the current page.';
        scroll.appendChild(card);
        panel.appendChild(scroll);
        return;
    }

    if (occs.length > 1) {
        const bar = document.createElement('div');
        bar.className = 'occ-bar';

        const lbl = document.createElement('span');
        lbl.className = 'occ-label';
        lbl.textContent = 'Occurrence:';
        bar.appendChild(lbl);

        if (selectedOccurrenceIndex[ec.id] == null || selectedOccurrenceIndex[ec.id] >= occs.length) {
            selectedOccurrenceIndex[ec.id] = occs.length - 1;
        }

        occs.forEach((occ, i) => {
            const btn = document.createElement('button');
            btn.className = 'occ-btn' + (i === selectedOccurrenceIndex[ec.id] ? ' active' : '');
            const t = new Date(occ.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            btn.textContent = `#${i + 1} ${t}`;
            btn.addEventListener('click', () => {
                selectedOccurrenceIndex[ec.id] = i;
                render();
            });
            bar.appendChild(btn);
        });

        panel.appendChild(bar);
    }

    const scroll = document.createElement('div');
    scroll.className = 'detail-scroll';

    const occIdx = selectedOccurrenceIndex[ec.id] ?? occs.length - 1;

    const occ    = occs[occIdx];
    const { contextResults } = validateEvent(ec, occ.eventInfo || {});

    const ctxTitle = document.createElement('div');
    ctxTitle.className = 'section-title';
    ctxTitle.textContent = 'Context Validation';
    scroll.appendChild(ctxTitle);

    const grid = document.createElement('div');
    grid.className = 'ctx-grid';

    for (const { key, label, present, issues } of contextResults) {
        const card = document.createElement('div');
        card.className = 'ctx-card ' + (!present ? 'error' : issues.length > 0 ? 'warning' : 'ok');

        const ch = document.createElement('div');
        ch.className = 'ctx-card-header';

        const icon = document.createElement('span');
        icon.className = 'ctx-icon';
        icon.textContent = !present ? '✗' : (issues.length > 0 ? '⚠' : '✓');
        icon.style.color  = !present ? '#D7373F' : (issues.length > 0 ? '#E68619' : '#2DA562');

        const name = document.createElement('span');
        name.className = 'ctx-name';
        name.textContent = label;
        name.style.color  = !present ? '#D7373F' : '';

        const status = document.createElement('span');
        status.className = 'ctx-status';
        status.textContent = !present ? 'missing' : (issues.length > 0 ? `${issues.length} issue${issues.length > 1 ? 's' : ''}` : 'valid');

        ch.appendChild(icon);
        ch.appendChild(name);
        ch.appendChild(status);
        card.appendChild(ch);

        if (issues.length > 0) {
            const issueBlock = document.createElement('div');
            issueBlock.className = 'ctx-issues';
            for (const iss of issues) {
                const p = document.createElement('div');
                p.className = 'ctx-issue';
                p.textContent = iss;
                issueBlock.appendChild(p);
            }
            card.appendChild(issueBlock);
        }

        if (present) {
            const ctxData = occ.eventInfo[key];
            const rows = flattenContext(ctxData);
            if (rows.length > 0) {
                const dataBlock = document.createElement('div');
                dataBlock.className = 'ctx-data';
                for (const [k, v] of rows) {
                    const row = document.createElement('div');
                    row.className = 'ctx-field';
                    const keyEl = document.createElement('span');
                    keyEl.className = 'ctx-field-key';
                    keyEl.textContent = k;
                    const valEl = document.createElement('span');
                    valEl.className = 'ctx-field-val';
                    valEl.textContent = v;
                    row.appendChild(keyEl);
                    row.appendChild(valEl);
                    dataBlock.appendChild(row);
                }
                card.appendChild(dataBlock);
            }
        }

        grid.appendChild(card);
    }
    scroll.appendChild(grid);

    if (occ.url) {
        const urlTitle = document.createElement('div');
        urlTitle.className = 'section-title';
        urlTitle.textContent = 'Fired on';
        scroll.appendChild(urlTitle);

        const urlRow = document.createElement('div');
        urlRow.className = 'url-row';
        urlRow.textContent = occ.url;
        scroll.appendChild(urlRow);
    }

    const rawTitle = document.createElement('div');
    rawTitle.className = 'section-title';
    rawTitle.textContent = 'Raw Event Info';
    scroll.appendChild(rawTitle);

    const rawToggle = document.createElement('span');
    rawToggle.className = 'raw-toggle';
    rawToggle.textContent = 'Show raw data';

    const rawPre = document.createElement('pre');
    rawPre.className = 'raw-pre';
    rawPre.textContent = JSON.stringify(occ.eventInfo, null, 2);

    rawToggle.addEventListener('click', () => {
        const vis = rawPre.classList.toggle('visible');
        rawToggle.textContent = vis ? 'Hide raw data' : 'Show raw data';
    });

    scroll.appendChild(rawToggle);
    scroll.appendChild(rawPre);
    panel.appendChild(scroll);
}

// ── Header stats + missing events bar ────────────────────────────────────────

function renderStats(eventMap) {
    const total   = ALL_EVENTS.length;
    const fired   = ALL_EVENTS.filter(ec => (eventMap.get(ec.acdlEvent) || []).length > 0).length;
    const missing = ALL_EVENTS.filter(ec => (eventMap.get(ec.acdlEvent) || []).length === 0);

    let issueCount = 0;
    for (const ec of ALL_EVENTS) {
        const occs = eventMap.get(ec.acdlEvent) || [];
        if (occs.length > 0) {
            const { hasIssues } = validateEvent(ec, occs[occs.length - 1].eventInfo || {});
            if (hasIssues) issueCount++;
        }
    }

    document.getElementById('statFired').textContent    = fired;
    document.getElementById('statTotal').textContent    = total;
    document.getElementById('progressFill').style.width = `${(fired / total) * 100}%`;

    const pill = document.getElementById('statIssuesPill');
    if (issueCount > 0) {
        document.getElementById('statIssues').textContent = issueCount;
        pill.style.display    = '';
        pill.style.background = 'rgba(230,134,25,0.3)';
    } else {
        pill.style.display = 'none';
    }

    const missingPanel = document.getElementById('missingPanel');
    const missingList  = document.getElementById('missingList');
    missingList.innerHTML = '';

    if (hasAnyEvents() && missing.length > 0) {
        missingPanel.style.display = '';
        for (const ec of missing) {
            const tag = document.createElement('span');
            tag.className = 'missing-tag';
            tag.textContent = ec.acdlEvent;
            missingList.appendChild(tag);
        }
    } else {
        missingPanel.style.display = 'none';
    }

    const sb = document.getElementById('statusBar');
    if (!hasAnyEvents()) {
        sb.textContent = '';
        sb.className   = 'status-bar';
    } else if (issueCount === 0 && missing.length === 0) {
        sb.textContent = `All ${total} events captured — no data integrity issues`;
        sb.className   = 'status-bar ok';
    } else {
        const parts = [];
        if (missing.length) parts.push(`${missing.length} event${missing.length > 1 ? 's' : ''} not seen`);
        if (issueCount)     parts.push(`${issueCount} event${issueCount > 1 ? 's' : ''} with data integrity issues`);
        sb.textContent = parts.join(' · ');
        sb.className   = 'status-bar warning';
    }
}

// ── Master render ────────────────────────────────────────────────────────────

function render() {
    const eventMap = buildEventMap();

    if (!selectedEventId && hasAnyEvents()) {
        for (const ec of ALL_EVENTS) {
            if ((eventMap.get(ec.acdlEvent) || []).length > 0) {
                selectedEventId = ec.id;
                break;
            }
        }
    }

    renderSidebar(eventMap);
    renderMain(eventMap);
    renderStats(eventMap);
}

// ── Snowplow network capture ──────────────────────────────────────────────────
// Mirrors the technique used by github.com/snowplow/chrome-snowplow-inspector:
// chrome.devtools.network provides full HAR-format entries including POST bodies,
// so we can read Snowplow beacon payloads without touching the page JS at all.

const SP_URL_PATTERN = /^[^:]+:\/\/[^/?#;]+(\/[^/]+)*?\/(i\?(tv=|.*&tv=)|(com\.snowplowanalytics\.snowplow|collector)\/tp2)/i;

function b64Decode(s) {
    try {
        // Snowplow uses URL-safe base64 (- and _ instead of + and /)
        const standard = s.replace(/-/g, '+').replace(/_/g, '/');
        return decodeURIComponent(escape(atob(standard)));
    } catch (_) { return null; }
}

// Snowplow schema path segment → ACDL context key (real schemas omit the "-context" suffix)
const SP_SCHEMA_TO_CONTEXT = {
    'product':             'productContext',
    'storefront-instance': 'storefrontInstanceContext',
    'shopping-cart':       'shoppingCartContext',
    'order':               'orderContext',
    'changed-products':    'changedProductsContext',
    'recommendations':     'recommendationsContext',
};

// "iglu:com.adobe.magento.entity/storefront-instance/jsonschema/3-0-3" → "storefrontInstanceContext"
function schemaNameToKey(schemaUri) {
    const name = schemaUri.split('/')[1] || '';
    return SP_SCHEMA_TO_CONTEXT[name] || name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseSnowplowParams(params) {
    let eventName = null;
    const eventInfo = {};

    // Self-describing (unstructured) event — ue_px is base64url, ue_pr is plain JSON
    const rawUe = params.get('ue_px') || params.get('ue_pr');
    if (rawUe) {
        const text = params.has('ue_px') ? b64Decode(rawUe) : rawUe;
        if (text) {
            try {
                // { schema: "iglu:...unstruct_event...", data: { schema: "iglu:.../event-name/...", data: {...} } }
                const ue = JSON.parse(text);
                const innerSchema = ue?.data?.schema || '';
                const eventSlug = innerSchema.split('/')[1];
                if (eventSlug) eventName = eventSlug;
                Object.assign(eventInfo, ue?.data?.data || {});
            } catch (_) {}
        }
    }

    // Fallback for page-view (e=pv) and structured events (e=se)
    if (!eventName) {
        const e = params.get('e');
        if (e === 'pv') eventName = 'page-view';
        else if (e === 'se') {
            const cat = params.get('se_ca');
            const act = params.get('se_ac');
            if (cat === 'product' && act === 'view') {
                eventName = 'product-page-view';
            } else if (cat === 'recommendation-unit') {
                const SP_REC_ACTION = {
                    'view':                  'recs-unit-view',
                    'impression-render':     'recs-unit-impression-render',
                    'rec-click':             'recs-item-click',
                    'rec-add-to-cart-click': 'recs-item-add-to-cart-click',
                };
                eventName = SP_REC_ACTION[act] || null;
            } else {
                eventName = act || cat || null;
            }
        }
    }

    // Contexts — cx is base64url, co is plain JSON
    const rawCtx = params.get('cx') || params.get('co');
    if (rawCtx) {
        const text = params.has('cx') ? b64Decode(rawCtx) : rawCtx;
        if (text) {
            try {
                // { schema: "iglu:...contexts...", data: [ { schema: "iglu:.../context-name/...", data: {...} } ] }
                const ctx = JSON.parse(text);
                const recUnits = [];
                const recItemsByUnitId = {};
                for (const entity of (ctx?.data || [])) {
                    const schemaName = (entity.schema || '').split('/')[1];
                    if (schemaName === 'recommendation-unit') {
                        recUnits.push(entity.data);
                    } else if (schemaName === 'recommended-item') {
                        const uid = entity.data?.unitId;
                        if (uid) {
                            if (!recItemsByUnitId[uid]) recItemsByUnitId[uid] = [];
                            recItemsByUnitId[uid].push(entity.data);
                        }
                    } else {
                        const key = schemaNameToKey(entity.schema || '');
                        if (key) eventInfo[key] = entity.data;
                    }
                }
                if (recUnits.length > 0) {
                    eventInfo.recommendationsContext = {
                        units: recUnits.map(unit => ({
                            ...unit,
                            products: recItemsByUnitId[unit.unitId] || []
                        }))
                    };
                }
            } catch (_) {}
        }
    }

    // A standard Snowplow page view (e=pv) with product context is a product-page-view
    if (eventName === 'page-view' && eventInfo.productContext) {
        eventName = 'product-page-view';
    }

    // place-order sends the order increment ID in se_la rather than an order context schema
    if (eventName === 'place-order' && !eventInfo.orderContext && params.get('se_la')) {
        eventInfo.orderContext = { orderId: params.get('se_la') };
    }

    // Snowplow has no "page" context schema — derive pageType from the event name
    if (eventName && !eventInfo.pageContext) {
        const SP_PAGE_TYPE = {
            'product-page-view': 'product',
            'add-to-cart':       'product',
            'place-order':       'checkout',
        };
        eventInfo.pageContext = { pageType: SP_PAGE_TYPE[eventName] || 'cms' };
    }

    return { eventName, eventInfo, pageUrl: params.get('url') || '' };
}

function extractSnowplowPayloads(entry) {
    if (!SP_URL_PATTERN.test(entry.request.url)) return [];

    const paramSets = [];
    if (entry.request.method === 'GET') {
        try { paramSets.push(new Map(new URL(entry.request.url).searchParams)); } catch (_) {}
    } else if (entry.request.method === 'POST') {
        const body = entry.request.postData?.text;
        if (body) {
            try {
                const parsed = JSON.parse(body);
                for (const item of (parsed.data || [])) {
                    paramSets.push(new Map(Object.entries(item)));
                }
            } catch (_) {}
        }
    }

    const payloads = [];
    for (const params of paramSets) {
        const { eventName, eventInfo, pageUrl } = parseSnowplowParams(params);
        if (!eventName) continue;
        payloads.push({
            event: eventName,
            eventInfo,
            timestamp: Date.now(),
            url: pageUrl || entry.request.url,
            source: 'snowplow'
        });
    }
    return payloads;
}

// Seed from requests already visible in the DevTools Network panel
chrome.devtools.network.getHAR(harLog => {
    let added = 0;
    for (const entry of (harLog.entries || [])) {
        const payloads = extractSnowplowPayloads(entry);
        for (const p of payloads) { networkEvents.push(p); added++; }
    }
    if (added > 0) render();
});

// Real-time capture as new requests complete
chrome.devtools.network.onRequestFinished.addListener(entry => {
    const payloads = extractSnowplowPayloads(entry);
    if (payloads.length === 0) return;
    for (const p of payloads) networkEvents.push(p);
    render();
});

// ── Controls ─────────────────────────────────────────────────────────────────

document.getElementById('clearBtn').addEventListener('click', () => {
    allEvents = [];
    networkEvents = [];
    selectedOccurrenceIndex = {};
    selectedEventId = null;
    render();
    chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS', tabId });
});

render();
