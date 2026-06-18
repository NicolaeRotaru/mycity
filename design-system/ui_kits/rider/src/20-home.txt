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
