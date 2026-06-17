Order-status pill for the buyer/seller/rider flow — one source of truth for the 8 states, each with a Lucide icon and a tinted ring.

```jsx
<OrderStatusBadge status="OUT_FOR_DELIVERY" />
<OrderStatusBadge status="DELIVERED" size="sm" />
<OrderStatusBadge status="NEW" variant="inline" />
```

States: `NEW`, `ACCEPTED`, `READY`, `ASSIGNED`, `PICKED_UP`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELED`. Variants `pill` (default) / `inline` / `icon-only`. Load the Lucide UMD script on the page.
