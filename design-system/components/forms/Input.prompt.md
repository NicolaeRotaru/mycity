Labelled text field with hint, error and optional leading/trailing adornments. Every form field in the marketplace routes through this primitive.

```jsx
<Input label="Email" type="email" placeholder="nome@email.it" required />
<Input label="Password" hint="Almeno 8 caratteri"
  labelAction={<a href="#">Password dimenticata?</a>} />
<Input label="Cerca" leading={<i data-lucide="search" />} placeholder="Cerca a Piacenza…" />
<Input label="CAP" error="CAP non valido" defaultValue="0000" />
```

16px text avoids iOS zoom; focus ring is terracotta, error state is wine. `Field` is exported to wrap custom controls in the same label/hint/error shell.
