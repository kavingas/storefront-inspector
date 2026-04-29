/**
 * Runs in the page's MAIN world to intercept Adobe Client Data Layer (ACDL) events.
 * Sends captured events to content.js via window.postMessage.
 *
 * The MSE SDK publishes events by calling:
 *   window.adobeDataLayer.push(acdl => {
 *     acdl.push({ event: "event-name", eventInfo: { ...allContexts } })
 *   })
 *
 * We intercept at two levels:
 *   1. window.adobeDataLayer.push — wraps deferred functions to observe inner pushes
 *   2. adobeDataLayer:event DOM event — fired by ACDL when an event is processed
 */
(function () {
    'use strict';

    const SOURCE = 'commerce-events-debugger';

    const TRACKED_EVENTS = new Set([
        'page-view',
        'product-page-view',
        'add-to-cart',
        'place-order',
        'recs-unit-view',
        'recs-unit-impression-render',
        'recs-item-click',
        'recs-item-add-to-cart-click'
    ]);

    function postEvent(eventName, eventInfo) {
        if (!TRACKED_EVENTS.has(eventName)) return;
        try {
            window.postMessage({
                source: SOURCE,
                type: 'EVENT_CAPTURED',
                payload: {
                    event: eventName,
                    eventInfo: JSON.parse(JSON.stringify(eventInfo || {})),
                    timestamp: Date.now(),
                    url: window.location.href
                }
            }, '*');
        } catch (e) {
            // Serialization failed — send without eventInfo
            window.postMessage({
                source: SOURCE,
                type: 'EVENT_CAPTURED',
                payload: {
                    event: eventName,
                    eventInfo: {},
                    serializationError: String(e),
                    timestamp: Date.now(),
                    url: window.location.href
                }
            }, '*');
        }
    }

    // ── Strategy 1: adobeDataLayer:event DOM event ────────────────────────────
    // ACDL v2 dispatches this event on window whenever an event object is pushed.
    window.addEventListener('adobeDataLayer:event', function (e) {
        if (!e.detail) return;
        const eventName = e.detail.event;
        const eventInfo = e.detail.eventInfo || e.detail;
        if (eventName) postEvent(eventName, eventInfo);
    });

    // ── Strategy 2: Wrap window.adobeDataLayer.push ───────────────────────────
    // Intercepts the deferred-function pattern used by the MSE SDK.
    // The inner acdl.push({ event, eventInfo }) call is where we capture data.

    function wrapInnerAcdl(acdl) {
        const origPush = acdl.push.bind(acdl);
        return new Proxy(acdl, {
            get(target, prop) {
                if (prop === 'push') {
                    return function (...items) {
                        for (const item of items) {
                            if (item && typeof item === 'object' && item.event) {
                                postEvent(item.event, item.eventInfo);
                            }
                        }
                        return origPush(...items);
                    };
                }
                return target[prop];
            }
        });
    }

    function patchAdl(adl) {
        if (!adl || adl.__ceDebuggerPatched) return adl;
        // Capture ACDL's own push so deferred functions are still processed correctly.
        const origPush = typeof adl.push === 'function' ? adl.push.bind(adl) : Array.prototype.push.bind(adl);

        adl.push = function (...items) {
            for (const item of items) {
                if (typeof item === 'function') {
                    // Deferred push — wrap the acdl argument so inner pushes are visible
                    const wrapped = function (acdl) { item(wrapInnerAcdl(acdl)); };
                    return origPush(wrapped);
                }
                if (item && typeof item === 'object' && item.event) {
                    postEvent(item.event, item.eventInfo);
                }
            }
            return origPush(...items);
        };

        adl.__ceDebuggerPatched = true;
        return adl;
    }

    // Patch immediately if ACDL is already on window
    if (Array.isArray(window.adobeDataLayer)) {
        patchAdl(window.adobeDataLayer);
    }

    // Intercept future assignments (ACDL loads after our script)
    let _adl = window.adobeDataLayer;
    try {
        Object.defineProperty(window, 'adobeDataLayer', {
            configurable: true,
            enumerable: true,
            get() { return _adl; },
            set(val) { _adl = patchAdl(val); }
        });
    } catch (e) {
        // defineProperty failed — fallback: poll until ACDL appears
        const poll = setInterval(function () {
            if (window.adobeDataLayer && !window.adobeDataLayer.__ceDebuggerPatched) {
                patchAdl(window.adobeDataLayer);
                clearInterval(poll);
            }
        }, 100);
    }
})();
