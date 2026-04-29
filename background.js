/**
 * Service worker — stores captured events per tab and handles popup/panel queries.
 *
 * DevTools panels connect via chrome.runtime.onConnect with name 'devtools-panel'
 * and receive real-time EVENT_CAPTURED / EVENTS_CLEARED messages.
 */

const SESSION_KEY_PREFIX = 'tab_events_';

// tabId -> Port (one DevTools panel per tab)
const devtoolsPorts = new Map();

async function getTabEvents(tabId) {
    const key = SESSION_KEY_PREFIX + tabId;
    const result = await chrome.storage.session.get(key);
    return result[key] || [];
}

async function setTabEvents(tabId, events) {
    const key = SESSION_KEY_PREFIX + tabId;
    await chrome.storage.session.set({ [key]: events });
}

async function clearTabEvents(tabId) {
    const key = SESSION_KEY_PREFIX + tabId;
    await chrome.storage.session.remove(key);
}

async function updateBadge(tabId) {
    const events = await getTabEvents(tabId);
    const uniqueEventNames = new Set(events.map(e => e.event));
    const count = uniqueEventNames.size;
    try {
        await chrome.action.setBadgeText({
            text: count > 0 ? String(count) : '',
            tabId
        });
        await chrome.action.setBadgeBackgroundColor({ color: '#FA7300', tabId });
    } catch (e) {
        // Tab may have been closed
    }
}

function forwardToPanel(tabId, message) {
    const port = devtoolsPorts.get(tabId);
    if (!port) return;
    try { port.postMessage(message); } catch (e) { devtoolsPorts.delete(tabId); }
}

// ── DevTools panel port connections ──────────────────────────────────────────

chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'devtools-panel') return;

    port.onMessage.addListener(msg => {
        if (msg.type === 'INIT' && msg.tabId != null) {
            devtoolsPorts.set(msg.tabId, port);
            port.onDisconnect.addListener(() => devtoolsPorts.delete(msg.tabId));
        }
    });
});

// ── Message handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EVENT_CAPTURED' && sender.tab) {
        const tabId = sender.tab.id;
        getTabEvents(tabId).then(events => {
            events.push(message.payload);
            setTabEvents(tabId, events).then(() => {
                updateBadge(tabId);
                forwardToPanel(tabId, { type: 'EVENT_CAPTURED', payload: message.payload });
            });
        });
        return false;
    }

    if (message.type === 'GET_EVENTS') {
        getTabEvents(message.tabId).then(events => sendResponse({ events }));
        return true;
    }

    if (message.type === 'CLEAR_EVENTS') {
        clearTabEvents(message.tabId).then(() => {
            updateBadge(message.tabId);
            forwardToPanel(message.tabId, { type: 'EVENTS_CLEARED' });
            sendResponse({ ok: true });
        });
        return true;
    }
});

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(tabId => {
    clearTabEvents(tabId);
    devtoolsPorts.delete(tabId);
});
