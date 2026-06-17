// ===== Seller app shell =====
function App() {
  const [view, setView] = React.useState('dashboard');
  const [order, setOrder] = React.useState(null);
  const [orders, setOrders] = React.useState(window.SC_ORDERS);

  function nav(v) { setView(v); window.scrollTo(0, 0); }
  function advance(o, next) {
    setOrders((prev) => prev.map((x) => x.id === o.id ? { ...x, status: next } : x));
    setOrder((cur) => cur ? { ...cur, status: next } : cur);
  }

  const TITLES = {
    dashboard: ['Ciao, Giorgio 👋', 'Ecco com’è andata oggi a ' + window.SC_STORE.name],
    ordini: ['Ordini', 'Gestisci e fai avanzare gli ordini'],
    prodotti: ['Prodotti', 'Il tuo catalogo'],
    analytics: ['Analytics', 'Andamento del negozio'],
    incassi: ['Incassi', 'Pagamenti alla consegna e payout'],
    promozioni: ['Promozioni', 'Coupon e offerte'],
    recensioni: ['Recensioni', 'Cosa dicono i clienti'],
    clienti: ['Clienti', 'I tuoi clienti abituali'],
    profilo: ['Profilo negozio', 'Vetrina e impostazioni'],
  };
  const [title, subtitle] = TITLES[view] || ['', ''];
  const actions = view === 'prodotti'
    ? <Button variant="primary" icon="plus">Nuovo prodotto</Button>
    : view === 'dashboard'
      ? <Button variant="secondary" icon="external-link">Vai al negozio</Button>
      : null;

  // window.SC_ORDERS kept in sync for child views reading it
  window.SC_ORDERS = orders;

  return (
    <Layout active={view} onNav={nav} title={title} subtitle={subtitle} actions={actions}>
      {view === 'dashboard' && <Dashboard onNav={nav} onOpenOrder={setOrder} />}
      {view === 'ordini' && <OrdersView onOpenOrder={setOrder} />}
      {view === 'prodotti' && <ProductsView />}
      {view === 'analytics' && <AnalyticsView />}
      {view === 'incassi' && <EarningsView />}
      {view === 'promozioni' && <PromosView />}
      {view === 'recensioni' && <ReviewsView />}
      {view === 'clienti' && <CustomersView />}
      {view === 'profilo' && <ProfileView />}
      <OrderDetail order={order} onClose={() => setOrder(null)} onAdvance={advance} />
    </Layout>
  );
}
