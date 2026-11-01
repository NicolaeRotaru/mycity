'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload, Download, ArrowLeft, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { getAttributesForCategory } from '@/lib/category-attributes';
import { cosaMancaPerVendere } from '@/lib/products/prontoPerLaVendita';
import { CARICAMENTO_DA_FILE_ACCESO } from '@/lib/funzioni-al-lancio';

type ParsedRow = {
  name: string;
  description: string;
  price: number;
  stock: number;
  category_slug: string;
  /** Colonne facoltative del file: per un alimento senza, il prodotto nasce bozza. */
  allergeni: string;
  ingredienti: string;
  errors: string[];
};

type CategoriaDelFile = { id: string; slug: string; parent_id: string | null };

/**
 * 01/11/2026 — ondata 6. Il modello usa il punto e virgola: e' il separatore
 * con cui l'Excel italiano salva i CSV (la virgola e' quella dei decimali), e
 * cosi' il file scaricato, aperto e risalvato in Excel torna uguale.
 */
const TEMPLATE_CSV = `name;description;price;stock;category_slug;allergeni;ingredienti
"Pane casereccio";"Pane fresco a lievitazione naturale";4,50;20;alimentari;"Glutine";"Farina di grano tenero tipo 0, acqua, lievito madre, sale"
"T-shirt cotone";"100% cotone biologico, taglie S-XL";19,90;15;abbigliamento;;
"Caricatore USB-C";"Adattatore 65W, compatibile MacBook/iPad";29,00;8;elettronica;;`;

/** Quante volte compare `sep` fuori dalle virgolette. */
function contaFuoriVirgolette(line: string, sep: string): number {
  let n = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === sep && !inQuotes) n++;
  }
  return n;
}

/**
 * 01/11/2026 — ondata 6. Il lettore divideva solo sulla virgola: un file
 * salvato dall'Excel italiano (punto e virgola) arrivava come UNA colonna e il
 * negozio si sentiva dire «Colonne mancanti» su un file giusto. Il separatore
 * si riconosce dalla prima riga (quella dei nomi delle colonne), e il BOM che
 * Excel mette in testa ai CSV UTF-8 si toglie, se no la prima colonna si
 * chiama «\uFEFFname».
 */
function parseCsv(text: string): { headers: string[]; rows: string[][]; separatore: ';' | ',' } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], separatore: ',' };
  const separatore: ';' | ',' =
    contaFuoriVirgolette(lines[0], ';') > contaFuoriVirgolette(lines[0], ',') ? ';' : ',';

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === separatore && !inQuotes) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows, separatore };
}

/**
 * Bulk CSV upload — Operations PM: 50+ prodotti caricati in 1 click
 * vs 50 form individuali.
 *
 * Esperti senior consultati:
 * - Operations Manager: "Riduce time-to-onboard del seller da ore a minuti"
 * - UX Designer: "Anteprima validation prima del commit = niente errori
 *   senza ritorno"
 * - Security: "Sanitize ogni campo, no SQL injection via CSV malformato"
 * - Data Engineer: "Insert batch via Supabase con transazione atomica"
 */
function CaricamentoDaFile() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [categoryRows, setCategoryRows] = useState<CategoriaDelFile[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/seller/products/import'); return; }
      setUserId(data.user.id);
    });
    supabase.from('categories').select('id, slug, parent_id').then(({ data }) => {
      const m = new Map<string, string>();
      for (const c of data ?? []) m.set(c.slug, c.id);
      setCategories(m);
      setCategoryRows((data ?? []) as CategoriaDelFile[]);
    });
  }, [router]);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mycity-template-prodotti.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('File troppo grande (max 2MB)'); return; }
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    const required = ['name', 'description', 'price', 'stock', 'category_slug'];
    const missingHeaders = required.filter((h) => !headers.includes(h));
    if (missingHeaders.length > 0) {
      // Una sola colonna letta = il file non usa ne' «;» ne' «,» (es. tabulazioni).
      toast.error(
        headers.length <= 1
          ? 'Il file sembra salvato con un separatore diverso: le colonne vanno separate con il punto e virgola (;) o con la virgola (,). Scarica il modello, compilalo e salvalo come CSV.'
          : `Colonne mancanti: ${missingHeaders.join(', ')}`,
      );
      return;
    }

    const out: ParsedRow[] = rows.map((cols, idx) => {
      const get = (h: string) => cols[headers.indexOf(h)] ?? '';
      const row: ParsedRow = {
        name: get('name'),
        description: get('description'),
        price: Number(get('price').replace(',', '.')),
        stock: parseInt(get('stock'), 10) || 0,
        category_slug: get('category_slug').toLowerCase(),
        allergeni: headers.includes('allergeni') ? get('allergeni') : '',
        ingredienti: headers.includes('ingredienti') ? get('ingredienti') : '',
        errors: [],
      };
      // Validation
      if (!row.name || row.name.length < 2) row.errors.push('Nome troppo corto');
      if (row.name.length > 200) row.errors.push('Nome troppo lungo (max 200)');
      if (!Number.isFinite(row.price) || row.price <= 0) row.errors.push('Prezzo non valido');
      if (row.price > 10000) row.errors.push('Prezzo eccessivo (max €10.000)');
      if (row.stock < 0 || row.stock > 99999) row.errors.push('Stock non valido');
      if (row.category_slug && !categories.has(row.category_slug)) {
        row.errors.push(`Categoria '${row.category_slug}' non esiste`);
      }
      if (idx >= 500) row.errors.push('Limite 500 righe per import');
      return row;
    }).slice(0, 500);

    setParsed(out);
  };

  const importAll = async () => {
    if (!userId) return;
    const valid = parsed.filter((r) => r.errors.length === 0);
    if (valid.length === 0) { toast.error('Nessuna riga valida'); return; }

    setImporting(true);
    try {
      // Quante bozze per ogni cosa che manca, per dirlo al negoziante.
      const perMotivo = new Map<string, number>();
      let bozze = 0;
      const payload = valid.map((r) => {
        const categoryId = categories.get(r.category_slug);
        const attributes: Record<string, string> = {};
        if (r.allergeni.trim()) attributes.allergeni = r.allergeni.trim();
        if (r.ingredienti.trim()) attributes.ingredienti = r.ingredienti.trim();
        // 01/11/2026 — ondata 6. Il file salta il modulo, ma non il suo
        // controllo: stessa regola (`cosaMancaPerVendere`) per foto,
        // descrizione e campi obbligatori della categoria (allergeni e
        // ingredienti per gli alimenti). Prima solo gli alimenti nascevano
        // bozza: un prodotto senza foto ne' descrizione andava in vetrina.
        // Il file non porta foto, quindi chi arriva da qui nasce bozza e la
        // foto si aggiunge dalla scheda.
        const mancanti = cosaMancaPerVendere({
          name: r.name,
          description: r.description,
          price: r.price,
          haCategoria: Boolean(categoryId),
          categoriaTop: getAttributesForCategory(categoryRows, categoryId).topSlug,
          numeroFoto: 0,
          attributes,
        });
        const status: 'available' | 'draft' = mancanti.length > 0 ? 'draft' : 'available';
        if (status === 'draft') {
          bozze++;
          for (const m of mancanti) perMotivo.set(m, (perMotivo.get(m) ?? 0) + 1);
        }
        return {
          seller_id: userId,
          name: r.name,
          description: r.description,
          price: r.price,
          stock: r.stock,
          category_id: categoryId,
          attributes,
          status,
        };
      });
      // Batch insert
      const { error } = await supabase.from('products').insert(payload);
      if (error) throw error;
      toast.success(
        bozze > 0
          ? `${valid.length} prodotti importati · ${bozze} in bozza, non ancora in vendita. Manca: ${[...perMotivo]
              .map(([m, n]) => `${m} (${n})`)
              .join(', ')}. Completali da «I miei prodotti» per metterli in vendita.`
          : `${valid.length} prodotti importati`,
      );
      router.push('/seller/products');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setImporting(false);
    }
  };

  if (!userId) return <LoadingState />;

  const validCount = parsed.filter((r) => r.errors.length === 0).length;
  const errorCount = parsed.filter((r) => r.errors.length > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/seller/products" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft size={14} /> I miei prodotti
        </Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <FileSpreadsheet size={28} className="text-primary-600" />
          Importazione massiva CSV
        </h1>
        <p className="text-sm text-ink-500 mt-1">Carica fino a 500 prodotti in un colpo solo da Excel/Google Sheets.</p>
      </div>

      {/* Step 1: Template */}
      <section className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Step 1 · Scarica il template</h2>
        <p className="text-sm text-ink-600 mb-4">
          Scarica il file template, compilalo in Excel o Google Sheets, esportalo come CSV e ricaricalo qui.
        </p>
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold border border-cream-300"
        >
          <Download size={18} />
          Scarica template CSV
        </button>
        <div className="bg-cream-50 border border-cream-300 rounded-lg p-3 mt-4 text-xs text-ink-600">
          <p className="font-semibold mb-1">Colonne richieste:</p>
          <ul className="space-y-0.5">
            <li>• <code className="bg-white px-1">name</code> · nome prodotto (2-200 char)</li>
            <li>• <code className="bg-white px-1">description</code> · descrizione</li>
            <li>• <code className="bg-white px-1">price</code> · prezzo in € (decimali con punto o virgola)</li>
            <li>• <code className="bg-white px-1">stock</code> · quantità disponibile</li>
            <li>• <code className="bg-white px-1">category_slug</code> · alimentari, abbigliamento, casa, elettronica, libri, sport, giocattoli, giardino, bellezza</li>
            <li>• <code className="bg-white px-1">allergeni</code> · <code className="bg-white px-1">ingredienti</code> · obbligatori per gli alimentari</li>
            <li>• Il file non porta le foto: i prodotti caricati nascono in bozza e vanno in vendita quando aggiungi la foto dalla scheda (servono anche una descrizione di almeno 10 caratteri e, per gli alimentari, allergeni e ingredienti)</li>
            <li>• Va bene il file salvato da Excel in italiano (colonne separate dal punto e virgola) o con la virgola</li>
          </ul>
        </div>
      </section>

      {/* Step 2: Upload */}
      <section className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Step 2 · Carica il tuo CSV</h2>
        <label className="block">
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          <div className="border-2 border-dashed border-cream-300 hover:border-primary-300 rounded-xl p-8 text-center cursor-pointer transition-colors">
            <Upload size={32} className="mx-auto text-ink-400 mb-2" />
            <p className="text-sm font-semibold text-ink-700">Clicca per selezionare il file CSV</p>
            <p className="text-xs text-ink-400 mt-1">Max 2MB · max 500 righe</p>
          </div>
        </label>
      </section>

      {/* Step 3: Preview */}
      {parsed.length > 0 && (
        <section className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
          <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">
            Step 3 · Anteprima ({parsed.length} righe)
          </h2>
          <div className="flex items-center gap-3 mb-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-olive-700">
              <CheckCircle2 size={16} /> {validCount} valide
            </span>
            {errorCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <AlertCircle size={16} /> {errorCount} con errori
              </span>
            )}
          </div>

          <div className="overflow-x-auto border border-cream-200 rounded-lg max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-100 sticky top-0">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Nome</th>
                  <th className="text-left p-2">Prezzo</th>
                  <th className="text-left p-2">Stock</th>
                  <th className="text-left p-2">Categoria</th>
                  <th className="text-left p-2">Stato</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r, i) => (
                  <tr key={i} className={`border-t border-cream-200 ${r.errors.length > 0 ? 'bg-secondary-50' : ''}`}>
                    <td className="p-2 text-ink-400">{i + 1}</td>
                    <td className="p-2 font-medium text-ink-900 truncate max-w-xs">{r.name || '—'}</td>
                    <td className="p-2">{formatPrice(r.price)}</td>
                    <td className="p-2">{r.stock}</td>
                    <td className="p-2"><code className="text-[10px] bg-cream-100 px-1 rounded">{r.category_slug}</code></td>
                    <td className="p-2">
                      {r.errors.length === 0 ? (
                        <span className="text-olive-700 inline-flex items-center gap-1"><CheckCircle2 size={12} /> OK</span>
                      ) : (
                        <span className="text-secondary-700" title={r.errors.join(', ')}>{r.errors[0]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Button
              onClick={importAll}
              loading={importing}
              disabled={validCount === 0}
              fullWidth
              size="lg"
            >Importa {validCount} prodotti</Button>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Caricamento da file SPENTO al lancio (carta #209). Il lettore divide solo
 * sulla virgola, e l'Excel italiano salva col punto e virgola: il negozio si
 * vedeva rispondere «Colonne mancanti» su un file giusto. Prima di riaccendere,
 * il lettore va riparato (separatore, codifica, allergeni, misure del database).
 */
export default function BulkImportProductsPage() {
  if (!CARICAMENTO_DA_FILE_ACCESO) return <CaricamentoSpento />;
  return <CaricamentoDaFile />;
}

function CaricamentoSpento() {
  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/seller/products" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft size={14} aria-hidden /> Prodotti
      </Link>
      <h1 className="text-2xl font-bold text-ink-900">Importa prodotti da file</h1>
      <p className="text-sm text-ink-700">
        Il caricamento da file non è attivo: non legge ancora i file salvati con Excel in italiano. Inserisci i prodotti uno alla volta dal modulo.
      </p>
      <Link
        href="/seller/products/new"
        className="inline-flex items-center gap-1 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
      >
        Aggiungi un prodotto
      </Link>
    </div>
  );
}
