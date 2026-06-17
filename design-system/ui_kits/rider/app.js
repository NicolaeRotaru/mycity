/* AUTO-GENERATED from ui_kits/rider/src/*.js (numeric order). Do not edit directly. */
// ===== Shared + phone shell =====
const { Button, Badge, Card, OrderStatusBadge, Modal, EmptyState } = window.MyCityDesignSystem_105480;
const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const initials = (name) => (name || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}

const RD_TABS = [
  { id: 'home', icon: 'bike', label: 'Consegne' },
  { id: 'earnings', icon: 'wallet', label: 'Guadagni' },
  { id: 'availability', icon: 'calendar-clock', label: 'Turni' },
  { id: 'profile', icon: 'user', label: 'Profilo' },
];

// Phone frame: centers a 390×every-tall device on a warm backdrop.
function Phone({ children, tab, onTab }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, var(--cream-200), var(--cream-100))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '390px', height: '844px', maxHeight: '92vh', background: 'var(--surface-50)', borderRadius: '44px', boxShadow: '0 0 0 12px var(--ink-900), 0 30px 60px -15px rgba(28,26,24,.5)', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* status bar */}
        <div style={{ height: '44px', flexShrink: 0, background: 'var(--surface-0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'relative', zIndex: 5 }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>9:41</span>
          <span style={{ position: 'absolute', left: '50%', top: '8px', transform: 'translateX(-50%)', width: '110px', height: '26px', background: 'var(--ink-900)', borderRadius: '999px' }} />
          <span style={{ display: 'inline-flex', gap: '5px', alignItems: 'center', color: 'var(--ink-900)' }}><Lucide name="signal" size={15} color="var(--ink-900)" /><Lucide name="wifi" size={15} color="var(--ink-900)" /><Lucide name="battery-full" size={17} color="var(--ink-900)" /></span>
        </div>
        {/* scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>{children}</div>
        {/* bottom tab bar */}
        <nav style={{ flexShrink: 0, background: 'var(--surface-0)', borderTop: '1px solid var(--cream-300)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', padding: '8px 4px 22px' }}>
          {RD_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => onTab(t.id)} style={{ border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '4px', color: on ? 'var(--primary-700)' : 'var(--ink-400)', fontFamily: 'var(--font-sans)' }}>
                <Lucide name={t.icon} size={22} stroke={on ? 2.4 : 2} color={on ? 'var(--primary-700)' : 'var(--ink-400)'} />
                <span style={{ fontSize: '10px', fontWeight: on ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function ScreenHead({ title, sub, right }) {
  return (
    <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 800, color: 'var(--ink-900)' }}>{title}</h1>
        {sub && <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// ===== Home (online toggle + active + available + prep) =====
function Home({ online, onToggle, active, onOpenActive, onClaim }) {
  const r = window.RD_RIDER, k = window.RD_KPI;
  return (
    <div style={{ paddingBottom: '20px' }}>
      {/* rider header */}
      <div style={{ padding: '8px 20px 14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.initials}</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)', fontSize: '15px' }}>Ciao, {r.name.split(' ')[0]}</p>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Lucide name="star" size={12} color="var(--accent-500)" /> {String(r.rating).replace('.', ',')} · {r.deliveries} consegne</p>
        </div>
      </div>

      {/* online toggle */}
      <div style={{ margin: '0 16px 16px', borderRadius: 'var(--radius-2xl)', padding: '18px 20px', background: online ? 'linear-gradient(135deg, var(--olive-600), var(--olive-700))' : 'var(--surface-0)', border: online ? 'none' : '1px solid var(--cream-300)', color: online ? '#fff' : 'var(--ink-900)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: online ? 'var(--shadow-warm)' : 'none' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 800, fontSize: '18px', fontFamily: 'var(--font-serif)' }}>{online ? 'Sei online' : 'Sei offline'}</p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', opacity: online ? 0.85 : 0.6, color: online ? '#fff' : 'var(--ink-500)' }}>{online ? 'Ricevi le consegne disponibili' : 'Vai online per iniziare'}</p>
        </div>
        <button onClick={onToggle} aria-label="Toggle online" style={{ border: 0, cursor: 'pointer', width: '58px', height: '32px', borderRadius: '999px', background: online ? 'rgba(255,255,255,.3)' : 'var(--cream-300)', position: 'relative', transition: 'background var(--dur-base)' }}>
          <span style={{ position: 'absolute', top: '3px', left: online ? '29px' : '3px', width: '26px', height: '26px', borderRadius: '50%', background: '#fff', transition: 'left var(--dur-base)', boxShadow: 'var(--shadow-sm)' }} />
        </button>
      </div>

      {/* today mini stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', margin: '0 16px 18px' }}>
        {[['Oggi', fmt(k.todayEarned)], ['Consegne', k.todayDeliveries], ['Online', `${k.onlineHours}h`]].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--ink-900)' }}>{v}</p>
            <p style={{ margin: 0, fontSize: '10px', color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 700 }}>{l}</p>
          </div>
        ))}
      </div>

      {/* active delivery */}
      {active && (
        <div style={{ margin: '0 16px 18px' }}>
          <SectionLabel>La tua consegna</SectionLabel>
          <button onClick={onOpenActive} style={{ width: '100%', textAlign: 'left', border: '2px solid var(--accent-400)', background: 'var(--surface-0)', borderRadius: 'var(--radius-xl)', padding: '16px', cursor: 'pointer', fontFamily: 'var(--font-sans)', boxShadow: 'var(--shadow-warm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <OrderStatusBadge status={active.status} size="sm" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ink-400)' }}>#{active.id}</span>
            </div>
            <DeliveryRoute store={active.store} cust={active.custAddr} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--cream-200)' }}>
              <span style={{ fontSize: '13px', color: 'var(--ink-500)' }}><Lucide name="navigation" size={13} color="var(--ink-400)" style={{ verticalAlign: 'middle', marginRight: '4px' }} />{active.distance} · {active.eta}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--primary-700)', fontWeight: 700, fontSize: '14px' }}>Continua <Lucide name="arrow-right" size={16} color="var(--primary-700)" /></span>
            </div>
          </button>
        </div>
      )}

      {/* available orders */}
      {online ? (
        <div style={{ margin: '0 16px' }}>
          <SectionLabel>Ordini disponibili ({window.RD_AVAILABLE.length})</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {window.RD_AVAILABLE.map((o) => (
              <div key={o.id} style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-xl)', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <Badge variant="new" icon="package">Pronto</Badge>
                  {o.pay === 'cod' && <Badge variant="cod" icon="banknote">Contanti</Badge>}
                </div>
                <DeliveryRoute store={o.store} cust={o.custAddr} small />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--ink-400)' }}>Compenso · {o.distance}</p>
                    <p style={{ margin: 0, fontWeight: 800, color: 'var(--olive-700)', fontSize: '18px' }}>{fmt(o.fee)}</p>
                  </div>
                  <Button variant="accent" onClick={() => onClaim(o)}>Accetta</Button>
                </div>
              </div>
            ))}
          </div>

          {window.RD_PREP.length > 0 && (
            <div style={{ marginTop: '18px' }}>
              <SectionLabel>In preparazione · attendi</SectionLabel>
              {window.RD_PREP.map((o) => (
                <div key={o.id} style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-xl)', padding: '14px', opacity: 0.75, marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <Badge variant="local" icon="chef-hat">In preparazione</Badge>
                    <span style={{ fontWeight: 700, color: 'var(--olive-700)' }}>{fmt(o.fee)}</span>
                  </div>
                  <DeliveryRoute store={o.store} cust={o.custAddr} small />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ margin: '0 16px', padding: '32px 20px', textAlign: 'center', background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-xl)' }}>
          <span style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--olive-50)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}><Lucide name="power" size={26} color="var(--olive-600)" /></span>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)' }}>Sei offline</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>Vai online per vedere gli ordini disponibili nella tua zona.</p>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: 'var(--ink-700)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{children}</p>;
}
function DeliveryRoute({ store, cust, small }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: small ? '6px' : '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary-100)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name="store" size={13} color="var(--primary-700)" /></span>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{store}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--olive-100)', color: 'var(--olive-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name="map-pin" size={13} color="var(--olive-700)" /></span>
        <span style={{ fontSize: '13px', color: 'var(--ink-600)' }}>{cust}</span>
      </div>
    </div>
  );
}

// ===== Live delivery (full-screen flow over the phone content) =====
const RD_FLOW = ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const RD_ACTION = {
  ASSIGNED: { label: 'Sono al negozio · ritira', icon: 'package', sub: 'Vai al negozio a ritirare l’ordine' },
  PICKED_UP: { label: 'Inizia la consegna', icon: 'bike', sub: 'Ordine ritirato, vai dal cliente' },
  OUT_FOR_DELIVERY: { label: 'Consegnato', icon: 'check', sub: 'Sei arrivato dal cliente' },
};

function LiveDelivery({ order, onAdvance, onClose }) {
  const o = order;
  const stepIdx = RD_FLOW.indexOf(o.status);
  const action = RD_ACTION[o.status];
  const done = o.status === 'DELIVERED';
  return (
    <div style={{ position: 'absolute', inset: 0, top: '44px', background: 'var(--surface-50)', zIndex: 20, display: 'flex', flexDirection: 'column', animation: 'mc-slide-up var(--dur-medium) var(--ease-out-quint)' }}>
      {/* map placeholder */}
      <div style={{ position: 'relative', height: '220px', flexShrink: 0, background: 'linear-gradient(135deg, var(--olive-100), var(--cream-200))', overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px)' }} />
        <svg viewBox="0 0 390 220" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M70 180 Q 140 120 200 130 T 320 60" fill="none" stroke="var(--primary-600)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
        </svg>
        <span style={{ position: 'absolute', left: '60px', top: '168px', width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary-700)', border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-warm)' }}><Lucide name="store" size={14} color="#fff" /></span>
        <span style={{ position: 'absolute', left: '306px', top: '46px', width: '28px', height: '28px', borderRadius: '50%', background: 'var(--olive-600)', border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-warm)' }}><Lucide name="map-pin" size={14} color="#fff" /></span>
        <button onClick={onClose} aria-label="Chiudi" style={{ position: 'absolute', top: '12px', left: '12px', width: '36px', height: '36px', borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.95)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Lucide name="chevron-down" size={20} color="var(--ink-700)" /></button>
        <span style={{ position: 'absolute', top: '14px', right: '14px', background: 'rgba(28,26,24,.82)', color: '#fff', fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '999px' }}>{o.distance} · {o.eta}</span>
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <OrderStatusBadge status={o.status} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink-400)' }}>#{o.id}</span>
        </div>

        {/* progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '18px' }}>
          {RD_FLOW.map((s, i) => (
            <div key={s} style={{ flex: 1, height: '5px', borderRadius: '999px', background: i <= stepIdx ? 'var(--olive-500)' : 'var(--cream-300)' }} />
          ))}
        </div>

        {/* current target card */}
        {!done && (
          <Card variant="elevated" padding="lg" style={{ marginBottom: '14px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink-400)' }}>{stepIdx === 0 ? 'Ritira al negozio' : 'Consegna al cliente'}</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{stepIdx === 0 ? o.store : o.cust}</p>
            <p style={{ margin: '2px 0 12px', fontSize: '14px', color: 'var(--ink-600)' }}>{stepIdx === 0 ? o.storeAddr : o.custAddr}</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="secondary" size="sm" icon="navigation" fullWidth>Naviga</Button>
              <Button variant="secondary" size="sm" icon="phone" fullWidth>Chiama</Button>
            </div>
          </Card>
        )}

        {/* order summary */}
        <Card variant="bordered" padding="md" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '6px' }}><span style={{ color: 'var(--ink-500)' }}>Articoli</span><span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{o.items} prodotti</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '6px' }}><span style={{ color: 'var(--ink-500)' }}>Il tuo compenso</span><span style={{ fontWeight: 700, color: 'var(--olive-700)' }}>{fmt(o.fee)}</span></div>
          {o.pay === 'cod' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', padding: '10px 12px', background: 'var(--accent-100)', borderRadius: 'var(--radius-md)' }}>
              <Lucide name="banknote" size={18} color="var(--accent-800)" />
              <span style={{ fontSize: '13px', color: 'var(--accent-900)' }}>Incassa <strong>{fmt(o.total)}</strong> in contanti dal cliente.</span>
            </div>
          )}
        </Card>

        {done && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <span style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--olive-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}><Lucide name="check" size={32} stroke={3} color="var(--olive-700)" /></span>
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800, color: 'var(--ink-900)' }}>Consegna completata!</p>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-500)' }}>Hai guadagnato {fmt(o.fee)}{o.pay === 'cod' ? ` + ${fmt(o.total)} contanti incassati` : ''}.</p>
          </div>
        )}
      </div>

      {/* action footer */}
      <div style={{ flexShrink: 0, padding: '14px 18px 24px', borderTop: '1px solid var(--cream-200)', background: 'var(--surface-0)' }}>
        {done
          ? <Button variant="primary" size="lg" fullWidth onClick={onClose}>Torna alle consegne</Button>
          : <Button variant={o.status === 'OUT_FOR_DELIVERY' ? 'success' : 'primary'} size="lg" fullWidth icon={action.icon} onClick={() => onAdvance(o)}>{action.label}</Button>}
      </div>
    </div>
  );
}

// ===== Earnings · Availability · Profile =====
function Earnings() {
  const [period, setPeriod] = React.useState('7d');
  const periods = [['today', 'Oggi'], ['7d', '7 giorni'], ['30d', '30 giorni'], ['all', 'Tutto']];
  const k = window.RD_KPI, e7 = window.RD_EARN_7D, max = Math.max(...e7);
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  return (
    <div style={{ paddingBottom: '20px' }}>
      <ScreenHead title="Guadagni" sub="Tutto quello che hai incassato" />
      <div style={{ display: 'flex', gap: '6px', padding: '0 16px 14px', overflowX: 'auto' }}>
        {periods.map(([id, l]) => <button key={id} onClick={() => setPeriod(id)} style={{ flexShrink: 0, border: 0, background: period === id ? 'var(--accent-500)' : 'var(--surface-0)', color: period === id ? 'var(--ink-900)' : 'var(--ink-600)', fontWeight: 600, fontSize: '13px', padding: '7px 14px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--font-sans)', boxShadow: period === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)' }}>{l}</button>)}
      </div>

      {/* big number */}
      <div style={{ margin: '0 16px 16px', borderRadius: 'var(--radius-2xl)', padding: '22px', background: 'linear-gradient(135deg, var(--accent-100), var(--cream-200))', border: '1px solid var(--accent-200)' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent-800)' }}>Hai guadagnato</p>
        <p style={{ margin: '4px 0 0', fontSize: '46px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{fmt(k.weekEarned)}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px' }}>
          <div style={{ background: 'rgba(255,255,255,.6)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}><p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-500)', fontWeight: 700 }}>Consegne</p><p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--ink-900)' }}>{k.weekDeliveries}</p></div>
          <div style={{ background: 'rgba(255,255,255,.6)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}><p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-500)', fontWeight: 700 }}>Media/consegna</p><p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--ink-900)' }}>{fmt(k.avgPerDelivery)}</p></div>
        </div>
      </div>

      {/* chart */}
      <div style={{ margin: '0 16px 16px' }}>
        <Card variant="bordered" padding="md">
          <p style={{ margin: '0 0 14px', fontWeight: 700, color: 'var(--ink-900)', fontSize: '14px' }}>Ultimi 7 giorni</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '110px' }}>
            {e7.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}><div title={fmt(v)} style={{ width: '100%', height: `${(v / max) * 100}%`, minHeight: '5px', background: 'linear-gradient(180deg, var(--accent-400), var(--accent-600))', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }} /></div>
                <span style={{ fontSize: '10px', color: 'var(--ink-400)' }}>{days[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* payouts info */}
      <div style={{ margin: '0 16px' }}>
        <Card variant="flat" padding="md" style={{ background: 'var(--olive-50)', border: '1px solid var(--olive-200)' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Lucide name="landmark" size={18} color="var(--olive-700)" />
            <div>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--olive-900)' }}>Compensi sul tuo IBAN</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--olive-800)', lineHeight: 1.5 }}>Le consegne con carta vengono versate ~24h dopo. I contanti li incassi direttamente alla consegna.</p>
            </div>
          </div>
        </Card>
      </div>

      {/* history */}
      <div style={{ margin: '16px 16px 0' }}>
        <SectionLabel>Storico consegne</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {window.RD_HISTORY.map((h) => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '12px 14px' }}>
              <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--olive-50)', color: 'var(--olive-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name="check" size={17} stroke={2.4} color="var(--olive-700)" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--ink-900)' }}>{h.store} → {h.cust}</p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--ink-400)' }}>{h.when} · {h.pay === 'cod' ? 'Contanti' : 'Carta'}</p>
              </div>
              <span style={{ fontWeight: 700, color: 'var(--olive-700)' }}>{fmt(h.fee)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Availability({ online, onToggle }) {
  const [zones, setZones] = React.useState(window.RD_ZONES);
  const toggleZone = (i) => setZones((z) => z.map((x, j) => j === i ? { ...x, on: !x.on } : x));
  return (
    <div style={{ paddingBottom: '20px' }}>
      <ScreenHead title="Turni & zone" sub="Quando e dove vuoi consegnare" />
      <div style={{ margin: '0 16px 16px' }}>
        <Card variant="bordered" padding="md">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)' }}>Stato</p><p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>{online ? 'Online · ricevi consegne' : 'Offline'}</p></div>
            <button onClick={onToggle} style={{ border: 0, cursor: 'pointer', width: '52px', height: '30px', borderRadius: '999px', background: online ? 'var(--olive-500)' : 'var(--cream-300)', position: 'relative' }}><span style={{ position: 'absolute', top: '3px', left: online ? '25px' : '3px', width: '24px', height: '24px', borderRadius: '50%', background: '#fff', transition: 'left var(--dur-base)', boxShadow: 'var(--shadow-sm)' }} /></button>
          </div>
        </Card>
      </div>
      <div style={{ margin: '0 16px 16px' }}>
        <SectionLabel>Zone preferite</SectionLabel>
        <p style={{ margin: '-4px 0 12px', fontSize: '12px', color: 'var(--ink-500)' }}>Ricevi prima le consegne in queste zone.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {zones.map((z, i) => (
            <button key={z.name} onClick={() => toggleZone(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-0)', border: `1.5px solid ${z.on ? 'var(--primary-400)' : 'var(--cream-300)'}`, borderRadius: 'var(--radius-lg)', padding: '12px 14px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}><Lucide name="map-pin" size={15} color={z.on ? 'var(--primary-600)' : 'var(--ink-400)'} /> {z.name}</span>
              <Lucide name={z.on ? 'check-circle-2' : 'circle'} size={20} color={z.on ? 'var(--primary-600)' : 'var(--ink-300)'} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ margin: '0 16px' }}>
        <SectionLabel>Orari di punta</SectionLabel>
        <Card variant="flat" padding="md" style={{ background: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Lucide name="trending-up" size={18} color="var(--primary-700)" />
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--primary-900)', lineHeight: 1.5 }}>Più consegne tra le <strong>12–14</strong> e le <strong>19–21</strong>. Tieni la disponibilità ON nei picchi per guadagnare di più.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Profile() {
  const r = window.RD_RIDER;
  return (
    <div style={{ paddingBottom: '20px' }}>
      <div style={{ padding: '24px 20px', textAlign: 'center', background: 'linear-gradient(135deg, var(--primary-700), var(--secondary-700))', color: '#fff' }}>
        <span style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(255,255,255,.18)', border: '3px solid rgba(255,255,255,.3)', color: '#fff', fontWeight: 800, fontSize: '26px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.initials}</span>
        <p style={{ margin: '12px 0 0', fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800 }}>{r.name}</p>
        <p style={{ margin: '2px 0 0', fontSize: '13px', opacity: 0.85, display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Lucide name="star" size={14} color="var(--accent-300)" /> {String(r.rating).replace('.', ',')} · {r.deliveries} consegne</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', padding: '16px' }}>
        <InfoTile icon="bike" label="Veicolo" value={r.vehicle} />
        <InfoTile icon="map-pin" label="Zona base" value={r.zone} />
      </div>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {[['user', 'Dati personali'], ['landmark', 'IBAN e compensi'], ['bell', 'Notifiche'], ['shield-check', 'Documenti'], ['life-buoy', 'Assistenza'], ['log-out', 'Esci']].map(([ic, l]) => (
          <button key={l} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 0, borderBottom: '1px solid var(--cream-200)', background: 'transparent', padding: '14px 4px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '15px', color: l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-800)', textAlign: 'left', width: '100%' }}>
            <Lucide name={ic} size={19} color={l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-500)'} /> <span style={{ flex: 1 }}>{l}</span>
            {l !== 'Esci' && <Lucide name="chevron-right" size={17} color="var(--ink-300)" />}
          </button>
        ))}
      </div>
    </div>
  );
}
function InfoTile({ icon, label, value }) {
  return (
    <div style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '14px' }}>
      <Lucide name={icon} size={18} color="var(--primary-600)" />
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--ink-400)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{value}</p>
    </div>
  );
}

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

// ===== Bootstrap — mounts ONLY after index.html grants permission (window.__MC_ALLOW_MOUNT).
// _ds_bundle.js concatenates this file; its embedded copy runs during bundle-eval BEFORE the
// flag is set → bails. The real <script src="app.js"> runs AFTER the flag → mounts. Uses a
// fresh flag name so a stale bundle's old boot (pre-set & neutralized in index.html) can't interfere. =====
(function mcMount(){
  if (!window.__MC_ALLOW_MOUNT) return;
  if (window.__riderReady) return;
  var ns = window.MyCityDesignSystem_105480;
  if (typeof App === 'undefined' || !ns || !ns.Button || !window.RD_ACTIVE) return setTimeout(mcMount, 30);
  window.__riderReady = true;
  var root = document.getElementById('root');
  if (root) root.style.display = 'none';
  var mount = document.getElementById('mc-app');
  if (!mount) { mount = document.createElement('div'); mount.id = 'mc-app'; document.body.appendChild(mount); }
  ReactDOM.createRoot(mount).render(React.createElement(App));
})();
