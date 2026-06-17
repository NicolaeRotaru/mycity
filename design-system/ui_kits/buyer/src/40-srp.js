// ===== Search results page (SRP) — faceted filters + sort =====
const MC_SORTS = [
  ['rilevanza', 'Rilevanza'],
  ['prezzo-asc', 'Prezzo crescente'],
  ['prezzo-desc', 'Prezzo decrescente'],
  ['sconto', 'Sconto maggiore'],
  ['novita', 'Novità'],
];

function SearchResults({ allProducts, query, cat, onOpen, onAdd, onStore, onClearNav }) {
  const [priceMax, setPriceMax] = React.useState(40);
  const [stores, setStores] = React.useState(() => new Set());
  const [deliveryToday, setDeliveryToday] = React.useState(false);
  const [onlyDiscount, setOnlyDiscount] = React.useState(false);
  const [inStock, setInStock] = React.useState(false);
  const [sort, setSort] = React.useState('rilevanza');

  const storeNames = [...new Set(allProducts.map((p) => p.store))];

  let list = allProducts.filter((p) => {
    if (cat && p.cat !== cat) return false;
    if (query) { const q = query.toLowerCase(); if (!p.name.toLowerCase().includes(q) && !p.store.toLowerCase().includes(q) && !(p.tags || []).join(' ').toLowerCase().includes(q)) return false; }
    if (finalPrice(p) > priceMax) return false;
    if (stores.size && !stores.has(p.store)) return false;
    if (deliveryToday && !(storeBy(p.store) || {}).deliveryToday) return false;
    if (onlyDiscount && !(p.discountPercent > 0)) return false;
    if (inStock && p.stock === 0) return false;
    return true;
  });

  list = [...list].sort((a, b) => {
    if (sort === 'prezzo-asc') return finalPrice(a) - finalPrice(b);
    if (sort === 'prezzo-desc') return finalPrice(b) - finalPrice(a);
    if (sort === 'sconto') return (b.discountPercent || 0) - (a.discountPercent || 0);
    if (sort === 'novita') return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
    return 0;
  });

  const catLabel = cat ? (window.MC_CATEGORIES.find((c) => c.slug === cat) || {}).label : null;
  const heading = query ? `Risultati per “${query}”` : (catLabel || 'Tutti i prodotti');
  const activeFilters = (stores.size > 0) + deliveryToday + onlyDiscount + inStock + (priceMax < 40);

  function toggleStore(name) {
    setStores((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  function reset() { setPriceMax(40); setStores(new Set()); setDeliveryToday(false); setOnlyDiscount(false); setInStock(false); }

  return (
    <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ fontSize: '13px', color: 'var(--ink-500)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <a onClick={onClearNav} style={{ cursor: 'pointer', color: 'var(--ink-500)' }}>Home</a> <Lucide name="chevron-right" size={13} color="var(--ink-400)" /> <span style={{ color: 'var(--ink-700)' }}>{heading}</span>
      </div>
      <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 700, color: 'var(--ink-900)' }}>{heading}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', gap: '28px', marginTop: '18px', alignItems: 'start' }}>
        {/* filters */}
        <aside style={{ position: 'sticky', top: '128px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Filtri</span>
            {activeFilters > 0 && <button onClick={reset} style={{ border: 0, background: 'transparent', color: 'var(--primary-700)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Azzera</button>}
          </div>

          <FilterGroup title="Prezzo massimo">
            <input type="range" min="3" max="40" step="1" value={priceMax} onChange={(e) => setPriceMax(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary-600)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--ink-500)' }}><span>€3</span><strong style={{ color: 'var(--ink-900)' }}>fino a {fmt(priceMax)}</strong></div>
          </FilterGroup>

          <FilterGroup title="Disponibilità">
            <Checkbox label="Consegna oggi" checked={deliveryToday} onChange={(e) => setDeliveryToday(e.target.checked)} />
            <Checkbox label="Solo in offerta" checked={onlyDiscount} onChange={(e) => setOnlyDiscount(e.target.checked)} />
            <Checkbox label="Solo disponibili" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />
          </FilterGroup>

          <FilterGroup title="Negozio">
            {storeNames.map((s) => <Checkbox key={s} label={s} checked={stores.has(s)} onChange={() => toggleStore(s)} />)}
          </FilterGroup>
        </aside>

        {/* results */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '14px', color: 'var(--ink-500)' }}><strong style={{ color: 'var(--ink-900)' }}>{list.length}</strong> prodotti dai negozi di Piacenza</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ink-500)' }}>
              Ordina per
              <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ appearance: 'none', border: '1px solid var(--cream-300)', background: 'var(--surface-0)', borderRadius: 'var(--radius-md)', padding: '8px 30px 8px 12px', fontSize: '13px', fontWeight: 600, color: 'var(--ink-900)', fontFamily: 'var(--font-sans)', cursor: 'pointer', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'14\' height=\'14\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2378716c\' stroke-width=\'2.4\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}>
                {MC_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {list.length === 0
            ? <Card variant="flat" padding="lg"><EmptyState icon="search-x" title="Nessun risultato" description="Prova ad allargare i filtri o cambiare termine di ricerca." action={<Button variant="secondary" onClick={reset}>Azzera i filtri</Button>} /></Card>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {list.map((p) => <ProductGridCard key={p.id} p={p} onOpen={onOpen} onAdd={onAdd} onStore={onStore} />)}
              </div>}
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ title, children }) {
  return (
    <div style={{ borderTop: '1px solid var(--cream-300)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-800)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{title}</span>
      {children}
    </div>
  );
}
