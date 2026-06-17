// ===== Account hub (profilo, ordini, preferiti, notifiche, messaggi, indirizzi) =====
const MC_ACCOUNT_NAV = [
  { id: 'ordini', icon: 'package', label: 'I miei ordini' },
  { id: 'preferiti', icon: 'heart', label: 'Preferiti' },
  { id: 'messaggi', icon: 'message-circle', label: 'Messaggi' },
  { id: 'notifiche', icon: 'bell', label: 'Notifiche' },
  { id: 'indirizzi', icon: 'map-pin', label: 'Indirizzi' },
  { id: 'profilo', icon: 'user', label: 'Profilo' },
];

function AccountPage({ section = 'ordini', onSection, products, onOpen, onAdd, onStore, onOpenOrder }) {
  const u = window.MC_USER;
  return (
    <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '24px 20px', display: 'grid', gridTemplateColumns: '260px 1fr', gap: '28px', alignItems: 'start' }}>
      <aside style={{ position: 'sticky', top: '128px' }}>
        <Card variant="bordered" padding="md" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ width: '46px', height: '46px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, fontSize: '17px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{u.initials}</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)', fontSize: '15px' }}>{u.name}</p>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</p>
            </div>
          </div>
        </Card>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {MC_ACCOUNT_NAV.map((n) => {
            const on = section === n.id;
            return (
              <button key={n.id} onClick={() => onSection(n.id)} style={{ display: 'flex', alignItems: 'center', gap: '10px', border: 0, background: on ? 'var(--primary-50)' : 'transparent', color: on ? 'var(--primary-800)' : 'var(--ink-700)', fontWeight: on ? 700 : 500, fontSize: '14px', padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left' }}>
                <Lucide name={n.icon} size={18} color={on ? 'var(--primary-700)' : 'var(--ink-500)'} /> {n.label}
                {n.id === 'notifiche' && <span style={{ marginLeft: 'auto', background: 'var(--secondary-600)', color: '#fff', fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '1px 7px' }}>2</span>}
              </button>
            );
          })}
          <button style={{ display: 'flex', alignItems: 'center', gap: '10px', border: 0, background: 'transparent', color: 'var(--ink-500)', fontSize: '14px', padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', marginTop: '8px' }}><Lucide name="log-out" size={18} color="var(--ink-400)" /> Esci</button>
        </nav>
      </aside>

      <div style={{ minWidth: 0 }}>
        {section === 'ordini' && <OrdersList onOpenOrder={onOpenOrder} onReorder={onAdd} />}
        {section === 'preferiti' && <FavoritesView products={products} onOpen={onOpen} onAdd={onAdd} onStore={onStore} />}
        {section === 'messaggi' && <MessagesView />}
        {section === 'notifiche' && <NotificationsView />}
        {section === 'indirizzi' && <AddressesView />}
        {section === 'profilo' && <ProfileView />}
      </div>
    </div>
  );
}

function PageHead({ title, sub }) {
  return <div style={{ marginBottom: '18px' }}><h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '28px', fontWeight: 700, color: 'var(--ink-900)' }}>{title}</h1>{sub && <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-500)' }}>{sub}</p>}</div>;
}

function OrdersList({ onOpenOrder, onReorder }) {
  return (
    <div>
      <PageHead title="I miei ordini" sub={`${window.MC_ORDERS.length} ordini`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {window.MC_ORDERS.map((o) => {
          const lines = o.lines.map((l) => ({ p: window.MC_PRODUCTS.find((x) => x.id === l.id), q: l.q })).filter((x) => x.p);
          return (
            <Card key={o.id} variant="bordered" padding="md">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <strong style={{ fontSize: '15px', color: 'var(--ink-900)' }}>{o.id}</strong>
                  <span style={{ fontSize: '13px', color: 'var(--ink-500)' }}>{o.date} · {o.store}</span>
                </div>
                <OrderStatusBadge status={o.status} size="sm" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                  {lines.map(({ p, q }) => (
                    <div key={p.id} style={{ position: 'relative' }} title={`${p.name} ×${q}`}>
                      <img src={imgUrl(p.kw, p.galleryLocks[0])} alt={p.name} style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                      <span style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '17px', height: '17px', padding: '0 4px', borderRadius: '50%', background: 'var(--ink-900)', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{q}</span>
                    </div>
                  ))}
                  <span style={{ alignSelf: 'center', marginLeft: '6px', fontSize: '16px', fontWeight: 800, color: 'var(--ink-900)' }}>{fmt(o.total)}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(o.status === 'OUT_FOR_DELIVERY' || o.status === 'ASSIGNED' || o.status === 'NEW') && <Button variant="secondary" size="sm" icon="map-pin" onClick={() => onOpenOrder(o)}>Traccia</Button>}
                  <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => { lines.forEach(({ p, q }) => onReorder(p, q)); }}>Riordina</Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function FavoritesView({ products, onOpen, onAdd, onStore }) {
  const favs = window.MC_FAVORITES.map((id) => products.find((p) => p.id === id)).filter(Boolean);
  return (
    <div>
      <PageHead title="Preferiti" sub={`${favs.length} prodotti salvati`} />
      {favs.length === 0
        ? <EmptyState icon="heart" title="Nessun preferito" description="Tocca il cuore su un prodotto per salvarlo qui." />
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {favs.map((p) => <ProductGridCard key={p.id} p={p} onOpen={onOpen} onAdd={onAdd} onStore={onStore} />)}
          </div>}
    </div>
  );
}

function NotificationsView() {
  const TONE = { primary: ['var(--primary-100)', 'var(--primary-700)'], secondary: ['var(--secondary-100)', 'var(--secondary-600)'], accent: ['var(--accent-100)', 'var(--accent-700)'], olive: ['var(--olive-100)', 'var(--olive-700)'] };
  return (
    <div>
      <PageHead title="Notifiche" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {window.MC_NOTIFICATIONS.map((n) => (
          <Card key={n.id} variant={n.unread ? 'elevated' : 'bordered'} padding="md" style={n.unread ? { borderColor: 'var(--primary-200)' } : {}}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ width: '40px', height: '40px', borderRadius: '50%', background: TONE[n.tone][0], color: TONE[n.tone][1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name={n.icon} size={19} color={TONE[n.tone][1]} /></span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--ink-900)' }}>{n.title}</p>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-600)' }}>{n.body}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', color: 'var(--ink-400)' }}>{n.when}</span>
                {n.unread && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary-600)' }} />}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MessagesView() {
  const [active, setActive] = React.useState(window.MC_THREADS[0].id);
  const thread = window.MC_THREADS.find((t) => t.id === active);
  return (
    <div>
      <PageHead title="Messaggi" sub="Scrivi direttamente ai negozi" />
      <Card variant="bordered" padding="none">
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '440px' }}>
          <div style={{ borderRight: '1px solid var(--cream-200)', overflowY: 'auto' }}>
            {window.MC_THREADS.map((t) => (
              <button key={t.id} onClick={() => setActive(t.id)} style={{ display: 'flex', gap: '10px', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--cream-100)', background: active === t.id ? 'var(--primary-50)' : 'transparent', padding: '12px 14px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(t.store)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}><strong style={{ fontSize: '13px', color: 'var(--ink-900)' }}>{t.store}</strong><span style={{ fontSize: '11px', color: 'var(--ink-400)' }}>{t.when}</span></div>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last}</p>
                </div>
                {t.unread > 0 && <span style={{ alignSelf: 'center', background: 'var(--secondary-600)', color: '#fff', fontSize: '11px', fontWeight: 700, borderRadius: '999px', minWidth: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{t.unread}</span>}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--cream-200)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StoreChip name={thread.store} size={26} /> <Lucide name="badge-check" size={15} color="var(--primary-600)" />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--cream-50)' }}>
              {thread.msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.me ? 'flex-end' : 'flex-start', maxWidth: '72%' }}>
                  <div style={{ background: m.me ? 'var(--primary-700)' : '#fff', color: m.me ? '#fff' : 'var(--ink-800)', border: m.me ? 'none' : '1px solid var(--cream-300)', borderRadius: m.me ? '14px 14px 4px 14px' : '14px 14px 14px 4px', padding: '9px 13px', fontSize: '14px', lineHeight: 1.4 }}>{m.text}</div>
                  <span style={{ display: 'block', fontSize: '10px', color: 'var(--ink-400)', marginTop: '3px', textAlign: m.me ? 'right' : 'left' }}>{m.when}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cream-200)', display: 'flex', gap: '8px' }}>
              <input placeholder="Scrivi un messaggio…" style={{ flex: 1, border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-full)', padding: '10px 14px', fontSize: '14px', fontFamily: 'var(--font-sans)', outline: 'none' }} />
              <Button variant="primary" icon="send">Invia</Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AddressesView() {
  return (
    <div>
      <PageHead title="Indirizzi" sub="Dove consegniamo i tuoi ordini" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
        {window.MC_ADDRESSES.map((a) => (
          <Card key={a.id} variant="bordered" padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}><Badge variant="local">{a.label}</Badge>{a.def && <Badge variant="new">Predefinito</Badge>}</div>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)' }}>{a.name}</p>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-600)' }}>{a.street}</p>
            <p style={{ margin: '2px 0 0', fontSize: '14px', color: 'var(--ink-600)' }}>{a.city}</p>
            <p style={{ margin: '8px 0 14px', fontSize: '13px', color: 'var(--ink-500)' }}>{a.phone}</p>
            <div style={{ display: 'flex', gap: '8px' }}><Button variant="secondary" size="sm" icon="pencil">Modifica</Button><Button variant="ghost" size="sm" icon="trash-2">Elimina</Button></div>
          </Card>
        ))}
        <button style={{ border: '1.5px dashed var(--cream-400)', borderRadius: 'var(--radius-lg)', background: 'transparent', color: 'var(--primary-700)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', minHeight: '160px', fontFamily: 'var(--font-sans)', fontWeight: 600 }}><Lucide name="plus" size={24} /> Aggiungi indirizzo</button>
      </div>
    </div>
  );
}

function ProfileView() {
  const u = window.MC_USER;
  return (
    <div>
      <PageHead title="Profilo" />
      <Card variant="bordered" padding="lg" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <span style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, fontSize: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{u.initials}</span>
          <div><p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{u.name}</p><p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>Cliente dal {u.since}</p></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label="Nome e cognome" defaultValue={u.name} />
          <Input label="Email" defaultValue={u.email} type="email" />
          <Input label="Telefono" defaultValue={u.phone} />
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}><Button variant="primary">Salva modifiche</Button><Button variant="ghost">Annulla</Button></div>
        </div>
      </Card>
    </div>
  );
}
