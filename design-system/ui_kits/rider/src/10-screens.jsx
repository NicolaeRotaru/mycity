// ===== Rider screens =====
function ScreenHead({ title, sub, dark }) {
  return (
    <div style={{ padding: '6px 20px 14px' }}>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 800, color: dark ? '#fff' : 'var(--ink-900)' }}>{title}</h1>
      {sub && <p style={{ margin: '2px 0 0', fontSize: '13px', color: dark ? 'rgba(255,255,255,.7)' : 'var(--ink-500)' }}>{sub}</p>}
    </div>
  );
}

function HomeScreen({ online, onToggle, onStart, onOpenActive, active }) {
  const t = window.RD_TODAY;
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface-50)' }}>
      {/* online banner */}
      <div style={{ background: online ? 'var(--olive-600)' : 'var(--ink-700)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="bike" size={22} color="#fff" /></span>
          <div><p style={{ margin: 0, fontWeight: 700, fontSize: '15px' }}>{online ? 'Sei online' : 'Sei offline'}</p><p style={{ margin: 0, fontSize: '12px', opacity: .85 }}>{online ? `${t.hours} · zona ${window.RD_RIDER.zone}` : 'Vai online per ricevere consegne'}</p></div>
        </div>
        <button onClick={onToggle} aria-label="Toggle online" style={{ width: '52px', height: '30px', borderRadius: '999px', border: 0, background: online ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.2)', position: 'relative', cursor: 'pointer' }}>
          <span style={{ position: 'absolute', top: '3px', left: online ? '25px' : '3px', width: '24px', height: '24px', borderRadius: '50%', background: '#fff', transition: 'left var(--dur-base) var(--ease-out-quint)' }} />
        </button>
      </div>

      {/* today stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', padding: '16px 20px' }}>
        {[['Consegne', t.deliveries, 'package'], ['Guadagno', fmt(t.earnings), 'banknote'], ['Km', t.km, 'route']].map(([l, v, ic]) => (
          <div key={l} style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '12px', textAlign: 'center' }}>
            <Icon name={ic} size={18} color="var(--primary-600)" />
            <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 800, color: 'var(--ink-900)' }}>{v}</p>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--ink-500)' }}>{l}</p>
          </div>
        ))}
      </div>

      {/* active delivery */}
      {active && (
        <div style={{ padding: '0 20px 12px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--primary-700)' }}>Consegna in corso</p>
          <div onClick={onOpenActive} style={{ cursor: 'pointer', background: 'var(--surface-0)', border: '1.5px solid var(--primary-300)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-warm)' }}>
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', background: 'var(--primary-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="navigation" size={22} color="var(--primary-700)" /></span>
              <div style={{ flex: 1 }}><p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)' }}>{active.id} · {active.store}</p><p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>→ {active.customer} · {active.custArea}</p></div>
              <Icon name="chevron-right" size={20} color="var(--ink-400)" />
            </div>
          </div>
        </div>
      )}

      {/* offers */}
      {online && <div style={{ padding: '4px 20px 20px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-500)' }}>Consegne disponibili</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {window.RD_QUEUE.map((o) => <OfferCard key={o.id} o={o} onAccept={() => onStart(o)} disabled={!!active} />)}
        </div>
      </div>}
    </div>
  );
}

function OfferCard({ o, onAccept, disabled }) {
  return (
    <div style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-xl)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div><p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-400)' }}>{o.id}</p><p style={{ margin: '2px 0 0', fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800, color: 'var(--olive-700)' }}>+{fmt(o.payout)}</p></div>
        <div style={{ textAlign: 'right' }}><Badge variant="cod" icon="banknote">Incassa {fmt(o.cod)}</Badge><p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>{o.dist} km · ~{o.eta} min</p></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        <Hop icon="store" color="var(--ink-700)" label={o.store} sub={o.storeArea} />
        <Hop icon="map-pin" color="var(--primary-600)" label={o.customer} sub={o.custArea} />
      </div>
      <Button variant="primary" size="md" fullWidth icon="check" disabled={disabled} onClick={onAccept}>{disabled ? 'Completa la consegna in corso' : 'Accetta consegna'}</Button>
    </div>
  );
}
function Hop({ icon, color, label, sub }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--cream-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={14} color={color} /></span><div style={{ minWidth: 0 }}><span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{label}</span> <span style={{ fontSize: '12px', color: 'var(--ink-500)' }}>· {sub}</span></div></div>;
}

function DeliveryScreen({ delivery, step, onAdvance, onBack }) {
  const steps = window.RD_STEPS;
  const done = step >= steps.length;
  const cur = steps[Math.min(step, steps.length - 1)];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface-50)', overflow: 'hidden' }}>
      <div style={{ position: 'relative' }}>
        <MapStub height={240} />
        <button onClick={onBack} style={{ position: 'absolute', top: '12px', left: '14px', width: '38px', height: '38px', borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.95)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={20} color="var(--ink-800)" /></button>
        <div style={{ position: 'absolute', top: '12px', right: '14px', background: 'rgba(28,26,24,.85)', color: '#fff', borderRadius: 'var(--radius-full)', padding: '6px 12px', fontSize: '13px', fontWeight: 700 }}>{delivery.dist} km · ~{delivery.eta} min</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', marginTop: '-20px', background: 'var(--surface-50)', borderRadius: '20px 20px 0 0', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div><p style={{ margin: 0, fontWeight: 800, fontFamily: 'var(--font-serif)', fontSize: '20px', color: 'var(--ink-900)' }}>{delivery.id}</p><p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>Compenso {fmt(delivery.payout)}</p></div>
          <Badge variant="cod" icon="banknote">Incassa {fmt(delivery.cod)}</Badge>
        </div>

        {/* step list */}
        <div style={{ marginBottom: '16px' }}>
          {steps.map((s, i) => {
            const isDone = i < step, isCur = i === step;
            return (
              <div key={s.key} style={{ display: 'flex', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: isDone ? 'var(--olive-600)' : isCur ? 'var(--primary-600)' : 'var(--cream-200)', color: isDone || isCur ? '#fff' : 'var(--ink-400)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: isCur ? '3px solid var(--primary-200)' : 'none' }}><Icon name={isDone ? 'check' : s.icon} size={15} stroke={2.4} color={isDone || isCur ? '#fff' : 'var(--ink-400)'} /></span>
                  {i < steps.length - 1 && <span style={{ width: '2px', flex: 1, minHeight: '22px', background: isDone ? 'var(--olive-400)' : 'var(--cream-300)' }} />}
                </div>
                <div style={{ paddingBottom: '14px' }}>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: isCur ? 700 : 600, color: isDone || isCur ? 'var(--ink-900)' : 'var(--ink-400)' }}>{s.label}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>{s.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        {done
          ? <div style={{ textAlign: 'center', padding: '12px' }}><span style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--olive-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}><Icon name="check" size={30} stroke={3} color="var(--olive-700)" /></span><p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>Consegna completata!</p><p style={{ margin: '4px 0 14px', fontSize: '14px', color: 'var(--ink-600)' }}>+{fmt(delivery.payout)} · {fmt(delivery.cod)} contanti raccolti</p><Button variant="primary" fullWidth onClick={onBack}>Torna alle consegne</Button></div>
          : <Button variant={step === steps.length - 1 ? 'success' : 'primary'} size="lg" fullWidth icon={cur.icon} onClick={onAdvance}>{cur.cta}</Button>}
      </div>
    </div>
  );
}

function EarningsScreen() {
  const w = window.RD_EARN_WEEK; const total = w.reduce((a, b) => a + b, 0); const max = Math.max(...w);
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface-50)' }}>
      <ScreenHead title="Guadagni" sub="Questa settimana" />
      <div style={{ padding: '0 20px' }}>
        <Card variant="elevated" padding="lg">
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>Totale settimana</p>
          <p style={{ margin: '4px 0 16px', fontFamily: 'var(--font-serif)', fontSize: '34px', fontWeight: 800, color: 'var(--ink-900)' }}>{fmt(total)}</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '110px' }}>
            {w.map((v, i) => <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', justifyContent: 'flex-end' }}><div style={{ width: '100%', height: `${(v / max) * 100}%`, minHeight: '4px', background: i === w.length - 1 ? 'var(--primary-600)' : 'var(--accent-400)', borderRadius: '5px 5px 0 0' }} /><span style={{ fontSize: '11px', color: 'var(--ink-400)', fontWeight: 600 }}>{days[i]}</span></div>)}
          </div>
        </Card>
        <div style={{ marginTop: '16px', background: 'var(--secondary-50)', border: '1px solid var(--secondary-200)', borderRadius: 'var(--radius-xl)', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><p style={{ margin: 0, fontSize: '13px', color: 'var(--secondary-700)', fontWeight: 600 }}>Contanti da consegnare</p><p style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 800, color: 'var(--ink-900)' }}>{fmt(window.RD_CASH_TO_REMIT)}</p></div>
            <Icon name="wallet" size={28} color="var(--secondary-600)" />
          </div>
          <p style={{ margin: '8px 0 12px', fontSize: '12px', color: 'var(--ink-600)' }}>Consegna i contanti raccolti dai clienti al punto MyCity entro fine turno.</p>
          <Button variant="secondary" size="md" fullWidth icon="map-pin">Trova punto di consegna</Button>
        </div>
        <p style={{ margin: '20px 0 8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-500)' }}>Dettaglio di oggi</p>
        <Card variant="bordered" padding="md" style={{ marginBottom: '20px' }}>
          {[['Compensi consegne', '+' + fmt(34.8)], ['Bonus zona', '+' + fmt(3.7)], ['Mance', '+' + fmt(0)]].map(([l, v], i) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 2 ? '1px solid var(--cream-200)' : 'none', fontSize: '14px' }}><span style={{ color: 'var(--ink-600)' }}>{l}</span><span style={{ fontWeight: 700, color: 'var(--olive-700)' }}>{v}</span></div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function HistoryScreen() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface-50)' }}>
      <ScreenHead title="Storico" sub={`${window.RD_HISTORY.length} consegne oggi`} />
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {window.RD_HISTORY.map((h) => (
          <div key={h.id} style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', background: 'var(--olive-50)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={20} color="var(--olive-700)" /></span>
            <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)', fontSize: '14px' }}>{h.id}</p><p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)' }}>{h.when} · {h.from} → {h.to}</p></div>
            <div style={{ textAlign: 'right' }}><p style={{ margin: 0, fontWeight: 800, color: 'var(--olive-700)' }}>+{fmt(h.payout)}</p><p style={{ margin: 0, fontSize: '11px', color: 'var(--ink-400)' }}>contanti {fmt(h.cod)}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen() {
  const r = window.RD_RIDER;
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface-50)' }}>
      <div style={{ background: 'var(--primary-700)', color: '#fff', padding: '24px 20px 28px', textAlign: 'center' }}>
        <span style={{ width: '76px', height: '76px', borderRadius: '50%', background: 'rgba(255,255,255,.16)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-serif)', fontSize: '28px', fontWeight: 800, margin: '0 auto 10px' }}>{r.initials}</span>
        <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800 }}>{r.name}</p>
        <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: .85, display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}><Icon name="star" size={15} color="var(--accent-300)" /> {String(r.rating).replace('.', ',')} · {r.deliveries} consegne</p>
      </div>
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {[['bike', 'Mezzo', r.vehicle], ['map', 'Zona', r.zone], ['shield-check', 'Stato', 'Verificato']].map(([ic, l, v]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
            <Icon name={ic} size={20} color="var(--primary-600)" /><span style={{ flex: 1, fontSize: '13px', color: 'var(--ink-500)' }}>{l}</span><span style={{ fontWeight: 700, color: 'var(--ink-900)', fontSize: '14px' }}>{v}</span>
          </div>
        ))}
        <div style={{ marginTop: '8px' }}><Button variant="secondary" fullWidth icon="settings">Impostazioni</Button></div>
        <Button variant="ghost" fullWidth icon="log-out">Esci</Button>
      </div>
    </div>
  );
}
