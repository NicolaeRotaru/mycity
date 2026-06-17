// ===== Rider app shell =====
function App() {
  const [tab, setTab] = React.useState('home');
  const [online, setOnline] = React.useState(window.RD_TODAY.online);
  const [active, setActive] = React.useState(null);   // active delivery object
  const [step, setStep] = React.useState(0);
  const [inDelivery, setInDelivery] = React.useState(false);

  function startDelivery(o) { setActive(o); setStep(0); setInDelivery(true); }
  function openActive() { if (active) setInDelivery(true); }
  function advance() {
    setStep((s) => {
      const next = s + 1;
      if (next > window.RD_STEPS.length - 1) return next; // shows done state
      return next;
    });
  }
  function finishDelivery() { setInDelivery(false); setActive(null); setStep(0); setTab('home'); }

  const dark = tab === 'profilo';
  return (
    <PhoneFrame>
      <div style={{ background: dark ? 'var(--primary-700)' : 'var(--surface-50)', flexShrink: 0 }}><StatusBar dark={dark || inDelivery} /></div>
      {inDelivery && active
        ? <DeliveryScreen delivery={active} step={step} onAdvance={advance} onBack={step > window.RD_STEPS.length - 1 ? finishDelivery : () => setInDelivery(false)} />
        : <>
            {tab === 'home' && <HomeScreen online={online} onToggle={() => setOnline((v) => !v)} onStart={startDelivery} onOpenActive={openActive} active={active} />}
            {tab === 'guadagni' && <EarningsScreen />}
            {tab === 'storico' && <HistoryScreen />}
            {tab === 'profilo' && <ProfileScreen />}
            <BottomTab active={tab} onNav={setTab} />
          </>}
    </PhoneFrame>
  );
}
