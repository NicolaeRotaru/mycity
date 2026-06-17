Brand button — terracotta `primary`, mustard `accent` purchase CTA, wine `danger`; use it for any tap target.

```jsx
<Button variant="primary">Inizia a esplorare</Button>
<Button variant="accent" icon="shopping-cart">Aggiungi al carrello</Button>
<Button variant="secondary" iconRight="arrow-right">Esplora i negozi</Button>
<Button variant="ghost" size="sm">Salta</Button>
<Button variant="success" loading>Salvataggio…</Button>
```

Variants: `primary` (terracotta, default), `accent` (mustard, high-intent buy), `secondary` (white + cream border), `ghost`, `danger` (wine), `success` (olive). Sizes `sm`/`md`/`lg` — `md`/`lg` hit the 44px touch target. `shape="pill"` for rounded-full. Pass `icon`/`iconRight` a Lucide icon name (load the Lucide UMD script on the page) or a node. `href` renders an anchor.
