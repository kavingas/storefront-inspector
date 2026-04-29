'use strict';

// EVENT_GROUPS, ALL_EVENTS, CONTEXT_VALIDATORS, validateContext, validateEvent
// are provided by shared.js, loaded before this script.

// ── DOM Rendering ────────────────────────────────────────────────────────────

function getStatusClass(occurrences, eventConfig) {
    if (occurrences.length === 0) return 'not-fired';
    const { hasIssues } = validateEvent(eventConfig, occurrences[occurrences.length - 1].eventInfo || {});
    return hasIssues ? 'issues' : 'ok';
}

function renderContextResults(contextResults) {
    const ul = document.createElement('ul');
    ul.className = 'ctx-list';

    for (const { label, present, issues } of contextResults) {
        const li = document.createElement('li');
        li.className = 'ctx-item';

        const header = document.createElement('div');
        header.className = 'ctx-header';

        const icon = document.createElement('span');
        icon.className = 'ctx-icon';

        const labelEl = document.createElement('span');
        labelEl.className = 'ctx-label';
        labelEl.textContent = label;

        if (!present) {
            icon.textContent = '✗';
            icon.style.color = '#D7373F';
            labelEl.classList.add('missing');
        } else if (issues.length > 0) {
            icon.textContent = '⚠';
            icon.style.color = '#E68619';
        } else {
            icon.textContent = '✓';
            icon.style.color = '#2DA562';
        }

        header.appendChild(icon);
        header.appendChild(labelEl);
        li.appendChild(header);

        if (issues.length > 0) {
            const issueList = document.createElement('ul');
            issueList.className = 'ctx-issues';
            for (const issue of issues) {
                const issueLi = document.createElement('li');
                issueLi.className = 'ctx-issue';
                issueLi.textContent = issue;
                issueList.appendChild(issueLi);
            }
            li.appendChild(issueList);
        }

        ul.appendChild(li);
    }

    return ul;
}

function renderOccurrenceSelector(occurrences, currentIndex, onSelect) {
    if (occurrences.length <= 1) return null;

    const container = document.createElement('div');
    container.className = 'occurrence-selector';

    occurrences.forEach((occ, i) => {
        const btn = document.createElement('button');
        btn.className = 'occ-btn' + (i === currentIndex ? ' active' : '');
        const time = new Date(occ.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        btn.textContent = `#${i + 1} ${time}`;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(i);
        });
        container.appendChild(btn);
    });

    return container;
}

function renderEventRow(eventConfig, occurrences) {
    const sc = getStatusClass(occurrences, eventConfig);
    const fired = occurrences.length > 0;

    const row = document.createElement('div');
    row.className = 'event-row';

    const summary = document.createElement('div');
    summary.className = 'event-summary';

    const dot = document.createElement('div');
    dot.className = `status-dot ${sc}`;

    const name = document.createElement('div');
    name.className = 'event-name';
    name.textContent = eventConfig.label;

    const meta = document.createElement('div');
    meta.className = 'event-meta';
    meta.textContent = eventConfig.acdlEvent;

    summary.appendChild(dot);
    summary.appendChild(name);
    summary.appendChild(meta);

    if (fired) {
        const countBadge = document.createElement('span');
        countBadge.className = 'event-count';
        countBadge.textContent = occurrences.length;
        summary.appendChild(countBadge);
    }

    const expandIcon = document.createElement('span');
    expandIcon.className = 'expand-icon';
    expandIcon.textContent = '▶';
    summary.appendChild(expandIcon);

    const detail = document.createElement('div');
    detail.className = 'event-detail';

    let currentOccIndex = fired ? occurrences.length - 1 : 0;

    function renderDetail() {
        detail.innerHTML = '';

        if (!fired) {
            const hint = document.createElement('div');
            hint.className = 'not-fired-hint';
            hint.textContent = 'This event has not been captured on this page.';
            detail.appendChild(hint);
            return;
        }

        const occ = occurrences[currentOccIndex];
        const { contextResults } = validateEvent(eventConfig, occ.eventInfo || {});

        const selector = renderOccurrenceSelector(occurrences, currentOccIndex, (i) => {
            currentOccIndex = i;
            renderDetail();
        });
        if (selector) detail.appendChild(selector);

        const ctxTitle = document.createElement('div');
        ctxTitle.className = 'detail-section-title';
        ctxTitle.textContent = 'Context Validation';
        detail.appendChild(ctxTitle);
        detail.appendChild(renderContextResults(contextResults));

        if (occ.url) {
            const urlTitle = document.createElement('div');
            urlTitle.className = 'detail-section-title';
            urlTitle.textContent = 'Fired on';
            detail.appendChild(urlTitle);

            const urlEl = document.createElement('div');
            urlEl.style.cssText = 'font-size:11px;color:#555;word-break:break-all;margin-bottom:4px';
            urlEl.textContent = occ.url;
            detail.appendChild(urlEl);
        }

        const rawTitle = document.createElement('div');
        rawTitle.className = 'detail-section-title';
        rawTitle.textContent = 'Event Info';
        detail.appendChild(rawTitle);

        const rawToggle = document.createElement('span');
        rawToggle.className = 'raw-toggle';
        rawToggle.textContent = 'Show raw data';
        detail.appendChild(rawToggle);

        const rawData = document.createElement('pre');
        rawData.className = 'raw-data';
        rawData.textContent = JSON.stringify(occ.eventInfo, null, 2);
        detail.appendChild(rawData);

        rawToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const visible = rawData.classList.toggle('visible');
            rawToggle.textContent = visible ? 'Hide raw data' : 'Show raw data';
        });
    }

    renderDetail();

    summary.addEventListener('click', () => {
        if (row.classList.toggle('expanded')) renderDetail();
    });

    row.appendChild(summary);
    row.appendChild(detail);
    return row;
}

function renderAll(allEvents) {
    const container   = document.getElementById('scrollContainer');
    const emptyState  = document.getElementById('emptyState');
    const summaryText = document.getElementById('summaryText');
    const progressFill = document.getElementById('progressFill');
    const footer      = document.getElementById('footer');

    const eventMap = new Map();
    for (const ev of allEvents) {
        if (!eventMap.has(ev.event)) eventMap.set(ev.event, []);
        eventMap.get(ev.event).push(ev);
    }

    const total  = ALL_EVENTS.length;
    const fired  = ALL_EVENTS.filter(ec => (eventMap.get(ec.acdlEvent) || []).length > 0).length;
    const hasAny = allEvents.length > 0;

    emptyState.style.display = hasAny ? 'none' : 'block';
    summaryText.innerHTML = hasAny
        ? `<strong>${fired}/${total}</strong> events detected`
        : 'Waiting for events…';
    progressFill.style.width = `${(fired / total) * 100}%`;

    container.querySelectorAll('.section').forEach(s => s.remove());

    if (!hasAny) {
        footer.textContent = '';
        return;
    }

    for (const group of EVENT_GROUPS) {
        const section = document.createElement('div');
        section.className = 'section';

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'section-header';
        sectionHeader.textContent = group.group;
        section.appendChild(sectionHeader);

        for (const ec of group.events) {
            section.appendChild(renderEventRow(ec, eventMap.get(ec.acdlEvent) || []));
        }

        container.appendChild(section);
    }

    let issueCount = 0;
    for (const ec of ALL_EVENTS) {
        const occs = eventMap.get(ec.acdlEvent) || [];
        if (occs.length > 0) {
            const { hasIssues } = validateEvent(ec, occs[occs.length - 1].eventInfo || {});
            if (hasIssues) issueCount++;
        }
    }

    footer.textContent = issueCount === 0
        ? `${fired} event${fired !== 1 ? 's' : ''} captured — no data integrity issues`
        : `${issueCount} event${issueCount !== 1 ? 's' : ''} have data integrity issues`;
    footer.style.color = issueCount === 0 ? '#2DA562' : '#E68619';
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function getCurrentTabId() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]?.id));
    });
}

async function loadAndRender() {
    const tabId = await getCurrentTabId();
    if (!tabId) return;
    chrome.runtime.sendMessage({ type: 'GET_EVENTS', tabId }, response => {
        renderAll(response?.events || []);
    });
}

document.getElementById('clearBtn').addEventListener('click', async () => {
    const tabId = await getCurrentTabId();
    if (!tabId) return;
    chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS', tabId }, () => renderAll([]));
});

loadAndRender();
const refreshInterval = setInterval(loadAndRender, 1000);
window.addEventListener('unload', () => clearInterval(refreshInterval));
