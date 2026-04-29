/**
 * Runs in the isolated content-script world.
 * Bridges window.postMessage events from injected.js (MAIN world)
 * to the background service worker via chrome.runtime.sendMessage.
 */
(function () {
    'use strict';

    window.addEventListener('message', function (e) {
        if (
            e.source !== window ||
            !e.data ||
            e.data.source !== 'commerce-events-debugger' ||
            e.data.type !== 'EVENT_CAPTURED'
        ) {
            return;
        }

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: e.data.payload
        });
    });
})();
