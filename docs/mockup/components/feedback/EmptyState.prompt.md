Friendly empty / zero-result placeholder — soft terracotta icon medallion, serif title, optional action button.

```jsx
<EmptyState icon="shopping-cart" title="Il carrello è vuoto"
  description="Aggiungi prodotti dai negozi di Piacenza per iniziare."
  action={<Button variant="primary">Esplora i negozi</Button>} />
```

`tone` tints the medallion: `primary` (default), `olive`, `accent`, `secondary`. `icon` is any Lucide name (load the Lucide UMD script).
