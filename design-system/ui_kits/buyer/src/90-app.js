// ===== App shell — view state machine, cart, toast =====
function App() {
  const [view, setView] = React.useState('home');   // home|srp|store|product|checkout|tracking|account|auth
  const [current, setCurrent] = React.useState(null);
  const [store, setStore] = React.useState(null);
  const [cart, setCart] = React.useState([]);
  const [drawer, setDrawer] = React.useState(false);
  const [order, setOrder] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [committedQuery, setCommittedQuery] = React.useState('');
  const [cat, setCat] = React.useState(null);
  const [acctSection, setAcctSection] = React.useState('ordini');
  const [authMode, setAuthMode] = React.useState('login');
  const toastTimer = React.useRef(null);

  const all = window.MC_PRODUCTS;
  const stores = window.MC_STORES;
  const cartCount = cart.reduce((s, it) => s + it.qty, 0);

  function showToast(text) { setToast({ text }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2600); }
  function top() { window.scrollTo({ top: 0, behavior: 'auto' }); }

  function addToCart(p, qty = 1) {
    setCart((c) => {
      const ex = c.find((it) => it.id === p.id);
      if (ex) return c.map((it) => it.id === p.id ? { ...it, qty: it.qty + qty } : it);
      return [...c, { id: p.id, name: p.name, store: p.store, img: imgUrl(p.kw, p.galleryLocks[0]), finalPrice: finalPrice(p), qty }];
    });
    showToast(`${p.name.length > 28 ? p.name.slice(0, 28) + '…' : p.name} aggiunto`);
  }
  function changeQty(id, d) { setCart((c) => c.map((it) => it.id === id ? { ...it, qty: Math.max(1, it.qty + d) } : it)); }
  function removeItem(id) { setCart((c) => c.filter((it) => it.id !== id)); }

  function openProduct(p) { setCurrent(p); setView('product'); top(); }
  function openStore(s) { if (!s) return; setStore(s); setView('store'); top(); }
  function goHome() { setView('home'); setCat(null); setQuery(''); setCommittedQuery(''); top(); }
  function goSrp(nextCat) { setCat(nextCat ?? null); setView('srp'); top(); }
  function submitSearch() { setCommittedQuery(query); setView('srp'); top(); }
  function goAccount(section) { setAcctSection(section || 'ordini'); setView('account'); top(); }
  function goCheckout() { setDrawer(false); setView('checkout'); top(); }
  function openOrder(o) {
    const items = o.lines.map((l) => { const p = window.MC_PRODUCTS.find((x) => x.id === l.id); return p && { id: p.id, name: p.name, store: p.store, img: imgUrl(p.kw, p.galleryLocks[0]), finalPrice: finalPrice(p), qty: l.q }; }).filter(Boolean);
    setOrder({ id: o.id, items, total: o.total }); setView('tracking'); top();
  }

  function placeOrder(payload) {
    const id = 'PC-' + (2400 + Math.floor(Math.random() * 600));
    setOrder({ id, items: payload.items, total: payload.total, address: payload.address, slot: payload.slot });
    setView('tracking'); top();
  }
  function afterOrder() { setCart([]); setOrder(null); goHome(); }

  const showFooter = view === 'home' || view === 'srp';
  const dark = view !== 'auth';

  return (
    <>
      {dark && <Navbar cartCount={cartCount} onCart={() => setDrawer(true)} onHome={goHome}
        activeCat={cat} onCat={(c) => goSrp(c)} query={query} onQuery={setQuery} onSubmitSearch={submitSearch}
        onAccount={() => goAccount('ordini')} onFav={() => goAccount('preferiti')} onNotif={() => goAccount('notifiche')} />}

      <main style={{ minHeight: '70vh', background: 'var(--surface-50)' }}>
        {view === 'home' && <Home products={all} stores={stores} onOpen={openProduct} onAdd={addToCart} onStore={openStore} onExplore={() => goSrp(null)} />}
        {view === 'srp' && <SearchResults allProducts={all} query={committedQuery} cat={cat} onOpen={openProduct} onAdd={addToCart} onStore={openStore} onClearNav={goHome} />}
        {view === 'store' && store && <StorePage store={store} products={all} onBack={goHome} onOpen={openProduct} onAdd={addToCart} />}
        {view === 'product' && current && <ProductPage product={current} onBack={goHome} onAdd={addToCart} onOpen={openProduct} onStore={openStore} />}
        {view === 'checkout' && <CheckoutPage items={cart} onBack={() => setDrawer(true)} onPlace={placeOrder} />}
        {view === 'tracking' && order && <OrderTracking order={order} onContinue={afterOrder} onHome={afterOrder} />}
        {view === 'account' && <AccountPage section={acctSection} onSection={setAcctSection} products={all} onOpen={openProduct} onAdd={addToCart} onStore={openStore} onOpenOrder={openOrder} />}
        {view === 'auth' && <AuthPage mode={authMode} onAuth={goHome} onBack={goHome} onSwitch={setAuthMode} />}
        {showFooter && <Footer onAuth={() => setView('auth')} />}
      </main>

      <CartDrawer open={drawer} items={cart} onClose={() => setDrawer(false)}
        onQty={changeQty} onRemove={removeItem} onCheckout={goCheckout} onContinue={() => { setDrawer(false); goSrp(null); }} />

      <Toast toast={toast} onUndo={null} />
    </>
  );
}
