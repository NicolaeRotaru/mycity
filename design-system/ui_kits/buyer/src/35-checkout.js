// ===== Checkout (indirizzo → consegna → pagamento → conferma) =====
function CheckoutPage({ items, onBack, onPlace }) {
  const [addr, setAddr] = React.useState(window.MC_ADDRESSES.find((a) => a.def).id);
  const [slot, setSlot] = React.useState(window.MC_SLOTS.find((s) => s.fee === 0).id);
  const [pay, setPay] = React.useState('cod');
  const [note, setNote] = React.useState('');
  const subtotal = items.reduce((s, it) => s + it.finalPrice * it.qty, 0);
  const chosenSlot = window.MC_SLOTS.find((s) => s.id === slot) || {};
  const shipping = subtotal >= 25 ? 0 : (chosenSlot.fee || 0);
  const total = subtotal + shipping;

  return (
    <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '24px 20px' }}>
      <button onClick={onBack} style={backLink}><Lucide name="arrow-left" size={17} /> Torna al carrello</button>
      <h1 style={{ margin: '6px 0 20px', fontFamily: 'var(--font-serif)', fontSize: '32px', fontWeight: 700, color: 'var(--ink-900)' }}>Conferma il tuo ordine</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '28px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* indirizzo */}
          <StepCard n={1} icon="map-pin" title="Indirizzo di consegna">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {window.MC_ADDRESSES.map((a) => (
                <SelectTile key={a.id} active={addr === a.id} onClick={() => setAddr(a.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <Badge variant="local">{a.label}</Badge>{a.def && <span style={{ fontSize: '11px', color: 'var(--ink-400)' }}>Predefinito</span>}
                  </div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{a.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-600)' }}>{a.street}, {a.city}</p>
                </SelectTile>
              ))}
            </div>
            <button style={ghostAdd}><Lucide name="plus" size={15} /> Aggiungi nuovo indirizzo</button>
          </StepCard>

          {/* consegna */}
          <StepCard n={2} icon="truck" title="Quando vuoi riceverlo">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {window.MC_SLOTS.map((s) => (
                <SelectTile key={s.id} active={slot === s.id} onClick={() => setSlot(s.id)}>
                  {s.label && <span style={{ position: 'absolute', top: '-9px', left: '12px' }}><Badge variant={s.fee === 0 ? 'new' : 'urgency'}>{s.label}</Badge></span>}
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--ink-900)' }}>{s.day}</p>
                  <p style={{ margin: '2px 0 6px', fontSize: '13px', color: 'var(--ink-600)' }}>{s.time}</p>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: s.fee === 0 ? 'var(--olive-700)' : 'var(--ink-700)' }}>{s.fee === 0 ? 'Gratis' : fmt(s.fee)}</span>
                </SelectTile>
              ))}
            </div>
          </StepCard>

          {/* pagamento */}
          <StepCard n={3} icon="banknote" title="Come paghi">
            <SelectTile active={pay === 'cod'} onClick={() => setPay('cod')} row>
              <span style={payIcon('var(--olive-100)', 'var(--olive-700)')}><Lucide name="banknote" size={20} color="var(--olive-700)" /></span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--ink-900)' }}>Paga alla consegna · contanti</p>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-600)' }}>Paghi al rider quando arriva. Tieni pronti {fmt(total)}.</p>
              </div>
              <Badge variant="new">Consigliato</Badge>
            </SelectTile>
            <SelectTile active={pay === 'card'} onClick={() => setPay('card')} row style={{ marginTop: '10px', opacity: .7 }}>
              <span style={payIcon('var(--surface-200)', 'var(--ink-500)')}><Lucide name="credit-card" size={20} color="var(--ink-500)" /></span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--ink-900)' }}>Carta di credito</p>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>Presto disponibile</p>
              </div>
            </SelectTile>
            <div style={{ marginTop: '14px' }}>
              <Input label="Note per il rider (facoltativo)" placeholder="Es. citofono Bianchi, 2° piano" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </StepCard>
        </div>

        {/* riepilogo sticky */}
        <aside style={{ position: 'sticky', top: '128px' }}>
          <Card variant="elevated" padding="lg">
            <h2 style={{ margin: '0 0 14px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Riepilogo</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto', marginBottom: '12px' }}>
              {items.map((it) => (
                <div key={it.id} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
                    <img src={it.img} alt={it.name} style={{ width: '46px', height: '46px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                    <span style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '50%', background: 'var(--ink-900)', color: '#fff', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{it.qty}</span>
                  </div>
                  <span style={{ flex: 1, fontSize: '13px', color: 'var(--ink-700)', lineHeight: 1.3 }}>{it.name}</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(it.finalPrice * it.qty)}</span>
                </div>
              ))}
            </div>
            <Divider />
            <Row label="Subtotale" val={fmt(subtotal)} />
            <Row label={`Consegna · ${chosenSlot.day} ${chosenSlot.time}`} val={shipping === 0 ? 'Gratis' : fmt(shipping)} olive={shipping === 0} />
            <Divider />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: 800, color: 'var(--ink-900)', margin: '6px 0 14px' }}><span>Totale</span><span>{fmt(total)}</span></div>
            <Button variant="primary" size="lg" fullWidth iconRight="arrow-right" onClick={() => onPlace({ items, total, slot: chosenSlot, address: window.MC_ADDRESSES.find((a) => a.id === addr) })}>Conferma e ordina</Button>
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--ink-500)', textAlign: 'center' }}>Confermando accetti i termini. Paghi solo alla consegna.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

const backLink = { display: 'inline-flex', alignItems: 'center', gap: '6px', border: 0, background: 'transparent', color: 'var(--ink-600)', fontSize: '14px', fontWeight: 500, cursor: 'pointer', padding: '8px 0', fontFamily: 'var(--font-sans)' };
const ghostAdd = { display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '12px', border: '1px dashed var(--cream-400)', background: 'transparent', color: 'var(--primary-700)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', width: '100%', justifyContent: 'center' };
const payIcon = (bg, fg) => ({ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 });

function StepCard({ n, icon, title, children }) {
  return (
    <Card variant="bordered" padding="lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary-700)', color: '#fff', fontSize: '14px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>{n}</span>
        <Lucide name={icon} size={18} color="var(--primary-700)" />
        <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function SelectTile({ active, onClick, children, row, style }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', textAlign: 'left', cursor: 'pointer', display: row ? 'flex' : 'block', alignItems: 'center', gap: '12px', width: '100%', background: active ? 'var(--primary-50)' : 'var(--surface-0)', border: `1.5px solid ${active ? 'var(--primary-500)' : 'var(--cream-300)'}`, borderRadius: 'var(--radius-lg)', padding: '14px', fontFamily: 'var(--font-sans)', boxShadow: active ? '0 0 0 3px rgba(228,122,90,.15)' : 'none', transition: 'border-color var(--dur-base), background var(--dur-base)', ...style }}>
      {children}
    </button>
  );
}

function Row({ label, val, olive }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--ink-600)', padding: '3px 0' }}><span>{label}</span><span style={{ fontWeight: 600, color: olive ? 'var(--olive-700)' : 'var(--ink-800)' }}>{val}</span></div>;
}
function Divider() { return <div style={{ height: '1px', background: 'var(--cream-300)', margin: '10px 0' }} />; }
