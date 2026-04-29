'use strict';

const EVENT_GROUPS = [
    {
        group: 'Adobe Commerce Events',
        events: [
            {
                id: 'page-view',
                label: 'Page View',
                acdlEvent: 'page-view',
                contexts: ['pageContext', 'storefrontInstanceContext']
            },
            {
                id: 'product-view',
                label: 'Product View',
                acdlEvent: 'product-page-view',
                contexts: ['pageContext', 'storefrontInstanceContext', 'productContext']
            },
            {
                id: 'add-to-cart',
                label: 'Add to Cart',
                acdlEvent: 'add-to-cart',
                contexts: ['pageContext', 'storefrontInstanceContext', 'productContext', 'shoppingCartContext']
            },
            {
                id: 'place-order',
                label: 'Place Order',
                acdlEvent: 'place-order',
                contexts: ['pageContext', 'storefrontInstanceContext', 'shoppingCartContext', 'orderContext']
            }
        ]
    },
    {
        group: 'Recommendations Events',
        events: [
            {
                id: 'recs-unit-render',
                label: 'Unit Render',
                acdlEvent: 'recs-unit-impression-render',
                contexts: ['pageContext', 'storefrontInstanceContext', 'recommendationsContext']
            },
            {
                id: 'recs-unit-view',
                label: 'Unit View',
                acdlEvent: 'recs-unit-view',
                contexts: ['pageContext', 'storefrontInstanceContext', 'recommendationsContext']
            },
            {
                id: 'recs-item-click',
                label: 'Item Click',
                acdlEvent: 'recs-item-click',
                contexts: ['pageContext', 'storefrontInstanceContext', 'recommendationsContext']
            },
            {
                id: 'recs-add-to-cart-click',
                label: 'Add to Cart Click',
                acdlEvent: 'recs-item-add-to-cart-click',
                contexts: ['pageContext', 'storefrontInstanceContext', 'recommendationsContext']
            }
        ]
    }
];

const ALL_EVENTS = EVENT_GROUPS.flatMap(g => g.events);

const CONTEXT_VALIDATORS = {
    pageContext: {
        label: 'Page',
        requiredFields: ['pageType']
    },
    storefrontInstanceContext: {
        label: 'Storefront',
        requiredFields: ['environmentId', 'environment', 'storeUrl', 'baseCurrencyCode', 'storeViewCurrencyCode']
    },
    productContext: {
        label: 'Product',
        requiredFields: ['name', 'sku'],
        check(ctx, issues) {
            // pricing is present in ACDL events but absent from the Snowplow product schema
            if (ctx.pricing) {
                if (ctx.pricing.regularPrice == null) issues.push('pricing.regularPrice is missing');
                if (ctx.pricing.currencyCode !== null && !ctx.pricing.currencyCode) issues.push('pricing.currencyCode is missing');
            }
        }
    },
    shoppingCartContext: {
        label: 'Shopping Cart',
        nonEmptyArrays: ['items'],
        check(ctx, issues) {
            // ACDL uses 'id'/'totalQuantity'; Snowplow schema uses 'cartId'/'itemsCount'
            if (ctx.id == null && ctx.cartId == null) issues.push('id (or cartId) is missing');
            if (ctx.totalQuantity == null && ctx.itemsCount == null) issues.push('totalQuantity (or itemsCount) is missing');
        }
    },
    orderContext: {
        label: 'Order',
        requiredFields: ['orderId']
    },
    changedProductsContext: {
        label: 'Changed Products',
        nonEmptyArrays: ['items'],
        check(ctx, issues) {
            if (Array.isArray(ctx.items)) {
                ctx.items.forEach((item, i) => {
                    if (!item.product) issues.push(`items[${i}].product is missing`);
                    if (item.quantity == null) issues.push(`items[${i}].quantity is missing`);
                });
            }
        }
    },
    recommendationsContext: {
        label: 'Recommendations',
        nonEmptyArrays: ['units'],
        check(ctx, issues) {
            if (!Array.isArray(ctx.units)) return;
            ctx.units.forEach((unit, i) => {
                if (!unit.unitId) issues.push(`units[${i}].unitId is missing`);
                // Snowplow uses 'name'; ACDL uses 'unitName'
                if (!unit.unitName && !unit.name) issues.push(`units[${i}].unitName is missing`);
                // Snowplow uses 'recType'; ACDL uses 'typeId'
                if (!unit.typeId && !unit.recType) issues.push(`units[${i}].typeId is missing`);
                // Snowplow omits products array but provides itemsCount
                const hasProducts = (Array.isArray(unit.products) && unit.products.length > 0) || unit.itemsCount > 0;
                if (!hasProducts) issues.push(`units[${i}].products is empty or missing`);
            });
        }
    }
};

function validateContext(contextKey, ctx) {
    if (ctx == null) return ['context is null or missing'];
    if (typeof ctx !== 'object') return [`expected object, got ${typeof ctx}`];

    const v = CONTEXT_VALIDATORS[contextKey];
    if (!v) return [];

    const issues = [];
    for (const field of (v.requiredFields || [])) {
        const val = ctx[field];
        if (val == null || val === '') issues.push(`${field} is missing or empty`);
    }
    for (const field of (v.nonEmptyArrays || [])) {
        const val = ctx[field];
        if (!Array.isArray(val) || val.length === 0) issues.push(`${field} must be a non-empty array`);
    }
    if (typeof v.check === 'function') v.check(ctx, issues);
    return issues;
}

function validateEvent(eventConfig, eventInfo) {
    const contextResults = [];
    let hasIssues = false;

    for (const ctxKey of eventConfig.contexts) {
        const ctx = eventInfo[ctxKey];
        const present = ctx != null;
        const issues = present ? validateContext(ctxKey, ctx) : ['context is missing'];
        const label = (CONTEXT_VALIDATORS[ctxKey] || {}).label || ctxKey;
        if (!present || issues.length > 0) hasIssues = true;
        contextResults.push({ key: ctxKey, label, present, issues });
    }

    return { contextResults, hasIssues };
}
