// OPENSTREETMAP — indirizzo, recapiti scritti sulla mappa libera e i concorrenti vicini, in 1-3 secondi.
// Il contratto del rapporto (regola 6) dice che i concorrenti si contano solo da OpenStreetMap: qui si
// fa lo stesso. Licenza ODbL: «© OpenStreetMap contributors» va scritto nella pagina.
// Le regole d'uso dei server pubblici: poche richieste, un nome dell'applicazione nell'intestazione.

const UA = 'MyCity-SchedaVenditore/1.0 (+https://www.mycity.it)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export type LuogoOsm = {
  nome: string;
  tipo: string | null;
  chiave: string | null; // es. "amenity=cafe"
  distanza: number;
  fonte: string; // https://www.openstreetmap.org/node/123
  indirizzo: string | null;
  telefono: string | null;
  sito: string | null;
  orari: string | null;
  instagram: string | null;
  facebook: string | null;
};

export type DatiOsm = {
  lat: number | null;
  lon: number | null;
  indirizzo: { testo: string; fonte: string } | null;
  luogo: LuogoOsm | null;
  concorrenti: { nome: string; tipo: string | null; distanza: number; fonte: string }[];
  concorrentiContati: number;
  raggio: number;
  avvisi: string[];
};

/** Le categorie in italiano: quello che il venditore riconosce in strada. */
const TIPI: Record<string, string> = {
  'amenity=cafe': 'Bar e caffetteria', 'amenity=bar': 'Bar', 'amenity=pub': 'Pub', 'amenity=restaurant': 'Ristorante',
  'amenity=fast_food': 'Cibo da asporto', 'amenity=ice_cream': 'Gelateria', 'amenity=pharmacy': 'Farmacia', 'amenity=biergarten': 'Birreria',
  'shop=bakery': 'Panetteria', 'shop=pastry': 'Pasticceria', 'shop=confectionery': 'Dolciumi', 'shop=chocolate': 'Cioccolateria',
  'shop=butcher': 'Macelleria', 'shop=greengrocer': 'Frutta e verdura', 'shop=deli': 'Gastronomia', 'shop=cheese': 'Formaggi',
  'shop=seafood': 'Pescheria', 'shop=wine': 'Enoteca', 'shop=alcohol': 'Enoteca', 'shop=coffee': 'Torrefazione', 'shop=tea': 'Tè e infusi',
  'shop=supermarket': 'Supermercato', 'shop=convenience': 'Alimentari', 'shop=farm': 'Prodotti della fattoria', 'shop=pasta': 'Pastificio',
  'shop=clothes': 'Abbigliamento', 'shop=shoes': 'Calzature', 'shop=boutique': 'Boutique', 'shop=bag': 'Borse', 'shop=jewelry': 'Gioielleria',
  'shop=optician': 'Ottica', 'shop=hairdresser': 'Parrucchiere', 'shop=beauty': 'Centro estetico', 'shop=cosmetics': 'Profumeria',
  'shop=perfumery': 'Profumeria', 'shop=florist': 'Fiorista', 'shop=garden_centre': 'Vivaio', 'shop=gift': 'Regali', 'shop=toys': 'Giocattoli',
  'shop=books': 'Libreria', 'shop=stationery': 'Cartoleria', 'shop=newsagent': 'Edicola', 'shop=tobacco': 'Tabaccheria',
  'shop=hardware': 'Ferramenta', 'shop=doityourself': 'Fai da te', 'shop=furniture': 'Arredamento', 'shop=interior_decoration': 'Arredo casa',
  'shop=houseware': 'Casalinghi', 'shop=electronics': 'Elettronica', 'shop=mobile_phone': 'Telefonia', 'shop=computer': 'Informatica',
  'shop=pet': 'Animali', 'shop=bicycle': 'Biciclette', 'shop=sports': 'Sport', 'shop=tailor': 'Sartoria', 'shop=dry_cleaning': 'Lavanderia',
  'shop=laundry': 'Lavanderia', 'shop=photo': 'Fotografia', 'shop=music': 'Musica', 'shop=art': 'Arte', 'shop=frame': 'Cornici',
  'shop=second_hand': 'Usato', 'shop=massage': 'Massaggi', 'shop=tattoo': 'Tatuaggi', 'shop=car_repair': 'Officina', 'shop=variety_store': 'Bazar',
  'leisure=fitness_centre': 'Palestra', 'tourism=hotel': 'Hotel', 'tourism=guest_house': 'Affittacamere', 'tourism=bed_and_breakfast': 'Bed and breakfast',
  'craft=confectionery': 'Laboratorio dolciario', 'craft=bakery': 'Laboratorio di panificazione', 'craft=shoemaker': 'Calzolaio', 'craft=tailor': 'Sartoria',
};

/** Le famiglie di concorrenti: chi si contende lo stesso cliente. */
const FAMIGLIE: string[][] = [
  ['amenity=cafe', 'amenity=bar', 'amenity=pub', 'amenity=biergarten'],
  ['shop=bakery', 'shop=pastry', 'shop=confectionery', 'shop=chocolate', 'craft=confectionery', 'craft=bakery'],
  ['amenity=restaurant', 'amenity=fast_food'],
  ['shop=wine', 'shop=alcohol'],
  ['shop=hairdresser', 'shop=beauty'],
  ['shop=cosmetics', 'shop=perfumery'],
  ['shop=clothes', 'shop=boutique'],
  ['shop=dry_cleaning', 'shop=laundry'],
  ['shop=deli', 'shop=cheese', 'shop=butcher'],
  ['shop=supermarket', 'shop=convenience'],
];
const CHIAVI = ['amenity', 'shop', 'craft', 'leisure', 'tourism'];

const chiaveDi = (tags: Record<string, string>) => {
  for (const k of CHIAVI) if (tags[k]) { const c = `${k}=${tags[k]}`; if (TIPI[c]) return c; }
  return null;
};
const famigliaDi = (c: string) => FAMIGLIE.find((f) => f.includes(c)) ?? [c];

const normale = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const VUOTE = new Set(['bar', 'caffe', 'cafe', 'il', 'la', 'lo', 'le', 'i', 'gli', 'di', 'da', 'del', 'della', 'e', 'srl', 'snc', 'sas', 'the']);
/** Quanto due nomi si somigliano, da 0 a 1 (parole in comune, senza le parole vuote). */
export function somiglianza(a: string, b: string) {
  const na = normale(a), nb = normale(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const pa = new Set(na.split(' ').filter((p) => !VUOTE.has(p)));
  const pb = new Set(nb.split(' ').filter((p) => !VUOTE.has(p)));
  if (!pa.size || !pb.size) return 0;
  let comuni = 0;
  for (const p of pa) if (pb.has(p)) comuni++;
  return comuni / Math.max(pa.size, pb.size);
}

export function distanzaMetri(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

const indirizzoDaTag = (t: Record<string, string>) => {
  const via = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const citta = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
  return via ? [via, citta].filter(Boolean).join(', ') : null;
};
const socialDaTag = (v: string | undefined, dominio: string) => {
  if (!v) return null;
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s.startsWith('https://') ? s : s.replace(/^http:/i, 'https:');
  const nome = s.replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '');
  return nome ? `https://www.${dominio}/${nome}` : null;
};

type Elemento = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** Dai dati grezzi di Overpass al luogo e ai concorrenti. Funzione pura: la prova la usa con dati finti. */
export function leggiOverpass(elementi: Elemento[], lat: number, lon: number, nome: string | null, raggio: number) {
  const luoghi = elementi
    .map((e) => {
      const p = e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
      const tags = e.tags ?? {};
      if (!p || !tags.name) return null;
      return { e, tags, chiave: chiaveDi(tags), distanza: distanzaMetri(lat, lon, p.lat, p.lon), fonte: `https://www.openstreetmap.org/${e.type}/${e.id}` };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  let scelto: (typeof luoghi)[number] | null = null;
  if (nome) {
    const candidati = luoghi
      .map((l) => ({ l, s: somiglianza(nome, l.tags.name) }))
      .filter(({ l, s }) => s >= 0.5 && l.distanza <= (s >= 0.9 ? 300 : 150))
      .sort((a, b) => b.s - a.s || a.l.distanza - b.l.distanza);
    scelto = candidati[0]?.l ?? null;
  }
  const luogo: LuogoOsm | null = scelto ? {
    nome: scelto.tags.name, tipo: scelto.chiave ? TIPI[scelto.chiave] : null, chiave: scelto.chiave, distanza: scelto.distanza, fonte: scelto.fonte,
    indirizzo: indirizzoDaTag(scelto.tags),
    telefono: scelto.tags.phone ?? scelto.tags['contact:phone'] ?? null,
    sito: scelto.tags.website ?? scelto.tags['contact:website'] ?? null,
    orari: scelto.tags.opening_hours ?? null,
    instagram: socialDaTag(scelto.tags['contact:instagram'], 'instagram.com'),
    facebook: socialDaTag(scelto.tags['contact:facebook'], 'facebook.com'),
  } : null;
  const famiglia = luogo?.chiave ? famigliaDi(luogo.chiave) : null;
  const tutti = famiglia
    ? luoghi.filter((l) => l !== scelto && l.chiave && famiglia.includes(l.chiave) && l.distanza <= raggio).sort((a, b) => a.distanza - b.distanza)
    : [];
  return {
    luogo,
    concorrenti: tutti.slice(0, 6).map((l) => ({ nome: l.tags.name, tipo: l.chiave ? TIPI[l.chiave] : null, distanza: l.distanza, fonte: l.fonte })),
    concorrentiContati: tutti.length,
  };
}

async function json(url: string, init: RequestInit, attesaMs: number) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(attesaMs), headers: { 'user-agent': UA, 'accept-language': 'it', ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`risposta ${r.status}`);
  return r.json();
}

const indirizzoNominatim = (a: Record<string, string> | undefined) => {
  if (!a) return null;
  const via = [a.road ?? a.pedestrian ?? a.square, a.house_number].filter(Boolean).join(' ');
  const citta = [a.postcode, a.city ?? a.town ?? a.village].filter(Boolean).join(' ');
  return via ? [via, citta].filter(Boolean).join(', ') : null;
};

/** Tutto OpenStreetMap in parallelo, al massimo `attesaMs`. Quello che non arriva in tempo resta vuoto. */
export async function cercaOsm({ lat, lon, nome, citta = 'Piacenza', attesaMs = 4500 }: { lat: number | null; lon: number | null; nome: string | null; citta?: string; attesaMs?: number }): Promise<DatiOsm> {
  const raggio = 450;
  const fuori: DatiOsm = { lat, lon, indirizzo: null, luogo: null, concorrenti: [], concorrentiContati: 0, raggio, avvisi: [] };
  // Senza punto sulla mappa: lo si cerca dal nome (Nominatim), poi si va avanti.
  if ((lat === null || lon === null) && nome) {
    try {
      const q = new URLSearchParams({ q: `${nome}, ${citta}`, format: 'jsonv2', limit: '1', countrycodes: 'it', addressdetails: '1' });
      const r = (await json(`${NOMINATIM}/search?${q}`, {}, Math.min(2500, attesaMs))) as { lat: string; lon: string; osm_type: string; osm_id: number; address?: Record<string, string> }[];
      if (r[0]) {
        fuori.lat = Number(r[0].lat); fuori.lon = Number(r[0].lon);
        const t = indirizzoNominatim(r[0].address);
        if (t) fuori.indirizzo = { testo: t, fonte: `https://www.openstreetmap.org/${r[0].osm_type}/${r[0].osm_id}` };
      } else fuori.avvisi.push('OpenStreetMap non trova questo nome: niente concorrenti vicini.');
    } catch { fuori.avvisi.push('OpenStreetMap non ha risposto in tempo.'); }
  }
  if (fuori.lat === null || fuori.lon === null) return fuori;
  const [la, lo] = [fuori.lat, fuori.lon];
  const query = `[out:json][timeout:5];(nwr(around:${raggio},${la},${lo})["name"]["amenity"];nwr(around:${raggio},${la},${lo})["name"]["shop"];nwr(around:${raggio},${la},${lo})["name"]["craft"];nwr(around:${raggio},${la},${lo})["name"]["leisure"="fitness_centre"];nwr(around:${raggio},${la},${lo})["name"]["tourism"~"^(hotel|guest_house|bed_and_breakfast)$"];);out tags center 600;`;
  const inverso = fuori.indirizzo ? Promise.resolve(null) : json(`${NOMINATIM}/reverse?${new URLSearchParams({ lat: String(la), lon: String(lo), format: 'jsonv2', zoom: '18', addressdetails: '1' })}`, {}, attesaMs).catch(() => null);
  const mappa = (async () => {
    for (const server of OVERPASS) {
      try {
        return (await json(server, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, attesaMs)) as { elements?: Elemento[] };
      } catch { /* il prossimo server */ }
    }
    return null;
  })();
  const [r, m] = await Promise.all([inverso, mappa]);
  if (r && typeof r === 'object') {
    const rr = r as { osm_type?: string; osm_id?: number; address?: Record<string, string> };
    const t = indirizzoNominatim(rr.address);
    if (t && rr.osm_type && rr.osm_id) fuori.indirizzo = { testo: t, fonte: `https://www.openstreetmap.org/${rr.osm_type}/${rr.osm_id}` };
  }
  if (m?.elements) {
    Object.assign(fuori, leggiOverpass(m.elements, la, lo, nome, raggio));
    if (fuori.luogo?.indirizzo) fuori.indirizzo = { testo: fuori.luogo.indirizzo, fonte: fuori.luogo.fonte };
  } else fuori.avvisi.push('La mappa libera non ha risposto in tempo: i concorrenti vicini li cerca l’AD.');
  return fuori;
}
