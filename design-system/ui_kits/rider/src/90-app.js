// ===== Rider app shell =====
function App() {
  const [tab, setTab] = React.useState('home');
  const [online, setOnline] = React.useState(true);
  const [active, setActive] = React.useState(window.RD_ACTIVE);
  const [live, setLive] = React.useState(false);

  function advance(o) {
    const i = RD_FLOW.indexOf(o.status);
    const next = RD_FLOW[i + 1];
    if (!next) { setLive(false); setActive(null); setTab('home'); return; }
    setActive({ ...o, status: next });
  }
  function claim(o) {
    setActive({ ...window.RD_ACTIVE, id: o.id, store: o.store, storeAddr: o.storeAddr, cust: o.cust, custAddr: o.custAddr, fee: o.fee, pay: o.pay, items: o.items, distance: o.distance, status: 'ASSIGNED' });
    setLive(true);
  }

  return (
    <Phone tab={tab} onTab={(t) => { setTab(t); }}>
      {tab === 'home' && <Home online={online} onToggle={() => setOnline((v) => !v)} active={active} onOpenActive={() => setLive(true)} onClaim={claim} />}
      {tab === 'earnings' && <Earnings />}
      {tab === 'availability' && <Availability online={online} onToggle={() => setOnline((v) => !v)} />}
      {tab === 'profile' && <Profile />}
      {live && active && <LiveDelivery order={active} onAdvance={advance} onClose={() => setLive(false)} />}
    </Phone>
  );
}
