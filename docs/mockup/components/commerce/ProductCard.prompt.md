The marketplace's signature card — the photo is the hero (~3/5), the body is essential: store chip · title · price · a discreet "+" add. Hover lifts the card and zooms the photo.

```jsx
<ProductCard
  name="Coppa Piacentina DOP 200g"
  price={8.9}
  discountPercent={20}
  storeName="Salumeria Verdi"
  image="/photo.jpg"
  freeShipping
  stock={2}
  onAdd={() => addToCart()}
/>
```

Composes `Badge` for discount/new/sold-out/low-stock/free-shipping. Use inside a responsive grid (`repeat(auto-fill, minmax(200px, 1fr))`). Load the Lucide UMD script for the badge icons. Prices render in `it-IT` EUR.
