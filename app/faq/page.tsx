'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, Truck, CreditCard, Undo2, Settings, Store, Bike, Mail, type LucideIcon } from 'lucide-react';
// Le promesse pubbliche nascono dagli stessi interruttori che le mantengono: il ritiro in negozio
// e' spento nel checkout e nelle due rotte, ma questa pagina lo prometteva lo stesso, con tanto di
// istruzione per selezionare un'opzione che non c'e'.
import { FRASE_PREZZO_NEGOZI } from '@/app/seller/earnings/commissione';
import { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } from '@/lib/constants';
import { CODICI_SCONTO_IN_CASSA } from '@/lib/funzioni-al-lancio';
import {
  RESO_ESCLUSI,
  fraseComeSiPaga,
  promesseRitiroInNegozio,
  rispostaComeOrdinare,
  rispostaCostoSpedizione,
  rispostaTempiDiConsegna,
} from '@/lib/promesse-pubbliche';

type QA = { q: string; a: React.ReactNode };
/** 300 → «3 €», 150 → «1,50 €». */
function euro(cents: number): string {
  const v = cents / 100;
  return `${Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')} €`;
}
type Section = { id: string; title: string; icon: LucideIcon; items: QA[] };

const SECTIONS: Section[] = [
  {
    id: 'ordini',
    title: 'Acquisti e ordini',
    icon: ShoppingCart,
    items: [
      // 3/9/2026 — La prima risposta prometteva il ritiro in negozio, che alla cassa non esiste:
      // adesso i passi per ordinare nascono dall'interruttore, come gia' le altre promesse.
      rispostaComeOrdinare(),
      {
        q: 'Posso comprare da più negozi nello stesso ordine?',
        // 5/11/2026 — Diceva «ognuno con la propria spedizione», e due domande sotto la
        // consegna si paga una volta sola per tutto il carrello (rispostaCostoSpedizione).
        a: 'Sì. Il carrello supporta più venditori: alla conferma viene creato un ordine per ciascun negozio, che lo prepara e lo gestisce. La consegna è una sola per tutto il carrello: quanto costa lo trovi nella risposta sulle spese di consegna.',
      },
      {
        q: 'Posso annullare un ordine?',
        a: 'Sì, finché il venditore non l\'ha preso in carico. Vai su “I miei ordini”, apri l\'ordine e clicca su “Annulla”.',
      },
    ],
  },
  {
    id: 'spedizioni',
    title: 'Spedizioni e consegne',
    icon: Truck,
    items: [
      rispostaCostoSpedizione(),
      rispostaTempiDiConsegna(),
      ...promesseRitiroInNegozio(),
      {
        q: 'Posso seguire la mia consegna?',
        a: 'Sì. Dalla sezione "I miei ordini" vedi lo stato in tempo reale: in preparazione, pronto, in consegna, consegnato.',
      },
    ],
  },
  {
    id: 'pagamenti',
    title: 'Pagamenti',
    icon: CreditCard,
    items: [
      {
        q: 'Quali metodi di pagamento accettate?',
        // 31/10/2026 (ondata 6) — Prometteva il «POS al rider», che non esiste, e carte e PayPal
        // «in arrivo»: la risposta adesso nasce dai metodi che la cassa offre davvero.
        a: fraseComeSiPaga(),
      },
      {
        q: 'Il pagamento è sicuro?',
        // Riesame del 16/10, quinto giro — la risposta prometteva sull'IBAN piu'
        // dell'informativa. Dove e quanto lo dice l'informativa, una volta sola
        // (lib/privacy/iban-per-email.ts): qui si rimanda li'.
        // 17/10/2026 («Semplifica») — l'IBAN DEL RIMBORSO non sta in nessun modulo
        // del sito e in nessuna colonna del database: lo chiede l'email del rimborso.
        // Collaudo del 17/10 — la frase senza «Se compri» e senza «del rimborso» era
        // falsa: il modulo per diventare venditore (/sell) chiede l'IBAN degli incassi
        // e lo salva (profiles.billing_iban), e l'informativa lo dice. Vale per chi
        // compra, con le stesse parole dell'informativa.
        a: (
          <>
            Sì. Tutti i dati transitano cifrati (HTTPS/TLS) e non conserviamo i dati delle carte. Se compri,
            non ti chiediamo l&apos;IBAN in nessun modulo del sito e nel nostro database non c&apos;è un campo
            per l&apos;IBAN del rimborso: se ti dobbiamo un rimborso con bonifico, te lo chiediamo per email e ce
            lo mandi rispondendo. Dove resta e per quanto lo trovi nell&apos;
            <Link href="/privacy" className="font-semibold underline">
              informativa privacy
            </Link>
            .
          </>
        ),
      },
      {
        q: 'Posso usare un codice sconto?',
        // 5/11/2026 — Con i codici sconto spenti al lancio il campo in cassa non c'è: la
        // risposta nasce dallo stesso interruttore della cassa.
        a: CODICI_SCONTO_IN_CASSA
          ? 'Sì: inserisci il codice nella sezione "Coupon" al checkout. Lo sconto viene applicato prima della conferma.'
          : 'Al momento no: in cassa non si possono usare codici sconto.',
      },
    ],
  },
  {
    id: 'resi',
    title: 'Resi e rimborsi',
    icon: Undo2,
    items: [
      {
        q: 'Posso restituire un prodotto?',
        // 5/11/2026 — Non diceva che pane e freschi sono esclusi (art. 59 Cod. Cons.), come
        // invece dicono i Termini e la pagina Resi.
        a: `Hai 14 giorni dalla consegna per esercitare il diritto di recesso, ${RESO_ESCLUSI} e quelli fatti su ordinazione. Vai su "I miei ordini" → apri l'ordine → "Richiedi reso".`,
      },
      {
        q: 'In quanto tempo ricevo il rimborso?',
        // R71 — Decisione di Nicola del 17/10/2026 («Semplifica»): i contanti tornano
        // sempre col bonifico, nessuna scelta del credito. I 14 giorni partono dal
        // recesso (Codice del Consumo, art. 56): la merce indietro, o la prova della
        // spedizione, e' solo la ragione per cui possiamo aspettare (comma 3).
        a: "Entro 14 giorni da quando ci comunichi il recesso. Possiamo aspettare di avere indietro la merce, o la prova che l'hai spedita. Se hai pagato con la carta, il rimborso torna sulla carta. Se hai pagato alla consegna, ti restituiamo i soldi con un bonifico: ti scriviamo per email per chiederti l'IBAN, e il bonifico lo facciamo appena ce lo mandi. La parte pagata con il credito MyCity torna come credito.",
      },
      {
        q: 'Chi paga la spedizione del reso?',
        a: 'Le spese di reso sono normalmente a carico dell\'acquirente, salvo prodotto difettoso o errore del venditore.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Account e impostazioni',
    icon: Settings,
    items: [
      {
        q: 'Come modifico i miei dati?',
        a: <>Da <Link href="/profile" className="text-primary-700 underline">Il tuo account</Link> puoi aggiornare nome, telefono, indirizzo. Da <Link href="/profile/settings" className="text-primary-700 underline">Impostazioni</Link> cambi password e preferenze notifiche.</>,
      },
      {
        q: 'Come elimino il mio account?',
        // La risposta diceva «rimuove tutti i tuoi dati»: la riga dei conti degli
        // ordini resta 10 anni, senza il nome (lib/account/cancellazione.ts). Si dice
        // cosa va via e cosa resta, e per il resto si rimanda all'informativa.
        // Collaudo del 17/10 — resta anche l'avviso del bonifico con l'email del
        // cliente: la cancellazione non tocca le notifiche degli amministratori, ed è
        // apposta (lib/privacy/iban-per-email.ts, L_AVVISO_A_CHI_PAGA). Secondo giro: la
        // frase diceva «Se ti dobbiamo un rimborso», ma sul sito non esiste un «pagato»
        // e nessuna potatura toglie l'avviso: resta anche a bonifico fatto. Le stesse
        // parole stanno nelle impostazioni, dove si cancella.
        a: <>Vai su <Link href="/profile/settings" className="text-primary-700 underline">Impostazioni → Elimina account</Link>. Togliamo il profilo, gli indirizzi e le preferenze. Resta la riga dei conti dei tuoi ordini, senza il tuo nome, per i 10 anni che chiede la legge. Se ti è stato approvato un rimborso con bonifico, già pagato o ancora da pagare, resta anche l&apos;avviso interno con la tua email, finché non lo cancelliamo noi: serve a chi fa il bonifico per scriverti e pagarti. I dettagli sono nell&apos;<Link href="/privacy" className="text-primary-700 underline">informativa privacy</Link>.</>,
      },
      {
        q: 'Ho dimenticato la password',
        a: <>Vai sulla pagina <Link href="/sign-in" className="text-primary-700 underline">Accedi</Link> e clicca su "Password dimenticata?" per riceverla via email.</>,
      },
    ],
  },
  {
    id: 'vendere',
    title: 'Vendere su MyCity',
    icon: Store,
    items: [
      {
        q: 'Come divento venditore?',
        a: <>Registra il tuo negozio in 5 minuti dalla pagina <Link href="/sell" className="text-primary-700 underline">Vendi su MyCity</Link>. Serve P.IVA attiva.</>,
      },
      {
        q: 'Quanto costa vendere?',
        // 31/10/2026 (ondata 6) — «Zero commissioni mensili»: il prezzo dei negozi è una frase sola.
        a: FRASE_PREZZO_NEGOZI,
      },
      {
        q: 'Come gestisco i miei ordini?',
        a: 'Dalla dashboard venditore vedi prodotti, ordini ricevuti, clienti, statistiche. Tutto in tempo reale.',
      },
    ],
  },
  {
    id: 'rider',
    title: 'Diventare rider',
    icon: Bike,
    items: [
      {
        q: 'Come faccio a consegnare per MyCity?',
        // 3/9/2026 — QUI SI MANDAVA LA GENTE A UNA CASELLA DI POSTA MENTRE IL
        // PERCORSO C'ERA GIÀ. La risposta diceva: «scrivi a info@mycity.it con
        // oggetto Candidatura Rider, ti contatteremo entro 48h». Due cose non
        // andavano. La prima: quell'indirizzo è su un dominio diverso da quello
        // dove vive il sito, e nel codice compare come ripiego — chi scrive non
        // sa se qualcuno legge. La seconda, più seria: l'iscrizione dei rider
        // esiste ed è automatica (/sign-up?role=rider, poi i documenti), ed è
        // la stessa strada che la pagina «Lavora con noi» indica già. Mandare a
        // una email vuol dire far aspettare una risposta che nessuno si è
        // impegnato a dare — le «48h» non le garantiva nessuno.
        a: <>Fai tutto dal sito: <Link href="/sign-up?role=rider" className="text-primary-700 underline">registrati come rider</Link>, poi carichi documento, patente e polizza dalla tua pagina documenti. Appena la verifica è finita puoi accettare le prime consegne.</>,
      },
      {
        q: 'Quanto guadagna un rider?',
        // 5/11/2026 — Diceva «in base alla distanza»: il compenso deciso da Nicola è fisso
        // per giro, più una cifra per ogni negozio in più (lib/constants.ts).
        a: `${euro(COMPENSO_RIDER_CENTS)} per ogni giro di consegna, più ${euro(COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS)} per ogni negozio in più nello stesso giro: non cambia con i chilometri. Vedi i guadagni in tempo reale dalla dashboard rider.`,
      },
    ],
  },
];

export default function FaqPage() {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3">Domande frequenti</h1>
        <p className="text-ink-600">Tutto quello che devi sapere su MyCity. Non trovi la risposta? <Link href="/contact" className="text-primary-700 underline">Scrivici</Link>.</p>
      </div>

      <div className="space-y-8">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
          // 5/11/2026 (S05) — Un id stabile per sezione: il Centro assistenza porta qui
          // con «/faq#ordini», e senza id il segnalibro apriva la pagina in cima.
          <section key={section.title} id={section.id} className="scroll-mt-24">
            <h2 className="text-xl font-bold text-ink-900 mb-4 flex items-center gap-2">
              <Icon size={24} className="text-primary-600 shrink-0" aria-hidden /> {section.title}
            </h2>
            <div className="space-y-2">
              {section.items.map((item, i) => {
                const key = `${section.title}-${i}`;
                const isOpen = !!open[key];
                return (
                  <div key={key} className="bg-white border border-cream-300 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-cream-50 transition-colors"
                    >
                      <span className="font-semibold text-ink-900">{item.q}</span>
                      <span className={`text-ink-400 text-xl transition-transform ${isOpen ? 'rotate-45' : ''}`}>+</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 text-sm text-ink-700 leading-relaxed border-t border-cream-200 pt-3">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>

      <div className="mt-12 bg-gradient-to-r from-primary-600 to-secondary-600 text-white rounded-2xl p-8 text-center">
        <h3 className="text-xl font-bold mb-2">Non hai trovato la risposta?</h3>
        <p className="text-primary-100 mb-4">Il nostro team risponde entro 24 ore lavorative.</p>
        <Link href="/contact" className="inline-flex items-center gap-2 bg-white text-primary-800 px-6 py-3 rounded-lg font-bold hover:bg-primary-50 transition-colors">
          <Mail size={18} aria-hidden /> Contattaci
        </Link>
      </div>
    </div>
  );
}
