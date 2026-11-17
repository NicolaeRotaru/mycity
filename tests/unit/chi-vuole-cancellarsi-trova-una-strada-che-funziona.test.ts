/**
 * 27/10/2026 — CHI VUOLE CANCELLARSI TROVA UNA STRADA CHE FUNZIONA.
 *
 * Nicola, 27/10: «risolvi il problema che il cliente ha quando deve cancellare
 * l account». La storia vera era questa. Una cliente va in Impostazioni →
 * Privacy e preme «Cancella account»: in produzione manca la chiave di servizio
 * e la risposta è «Servizio non configurato». Torna all informativa e usa il
 * modulo dei contatti: il modulo lancia, errore 500. Prova la casella privacy
 * mostrata nelle impostazioni: è un ripiego scritto nel codice, nessuno la
 * legge. Tre porte, tutte murate.
 *
 * E chi la cancellazione l aveva chiesta davvero — un fattorino con 120 € di
 * contanti non ancora versati — vedeva un conto alla rovescia fermo a zero:
 * il giro notturno calcolava ogni notte la spiegazione che gli dovevamo, e la
 * buttava via. Nessuno chiamava `recapitaAvvisi`.
 *
 * QUI SI ESEGUONO LE ROTTE VERE, non le librerie: la libreria degli avvisi
 * aveva già la sua prova verde, ed era proprio quella prova a far sembrare
 * fatto un lavoro che in produzione non girava.
 *
 * R02-004 — Qui restano le rotte (Cancella account, Scarica i miei dati, il modulo dei contatti).
 * La notte sta in riparazione-r02-la-notte-delle-cancellazioni-avvisa-chi-aspetta.test.ts, la
 * scansione delle pagine in riparazione-r02-nessuna-pagina-scrive-a-mano-la-casella-privacy.test.ts,
 * l'impianto comune in aiuti/riparazione-r02-giro-cancellazioni-di-prova.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error("SUPABASE_SERVICE_ROLE_KEY non configurata");
    return stato.mondo.admin;
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock("@/lib/account/cancellazione", () => ({
  cancellaAccount: async (_a: unknown, userId: string): Promise<Esito> =>
    stato.esiti[userId] ?? { ok: true, fileRimossi: 0, erroriFile: [] },
}));
// 27/10/2026 (secondo giro) — IL CONTROLLO D'ACCESSO È QUELLO VERO.
// Qui c'era un withAuth finto che chiamava la rotta e basta: saltava
// authenticate(), cioè proprio il punto in cui, senza chiave di servizio, la
// risposta era «Auth non configurato». La prova era verde su un ramo che in
// produzione non si eseguiva mai. Adesso si finge solo il servizio di accesso
// di Supabase (di chi è il gettone); withAuth, withAuthRateLimit e
// withCronAuth sono quelli di lib/api/middleware.ts.
vi.mock("@/lib/supabase/anonimo", () => ({
  creaClientAnonimo: () => ({
    auth: { getUser: async () => ({ data: { user: UTENTE }, error: null }) },
  }),
}));
vi.mock("@/lib/captcha", () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (x: unknown) => inviaEmail(x) }));

import { UTENTE, stato, inviaEmail, CASELLA, CTX, conGettone, corpo, richiestaAlModulo, preparaLaProva, type Esito } from "./aiuti/riparazione-r02-giro-cancellazioni-di-prova";
import { GET as statoCancellazione, POST as chiediCancellazione, DELETE as annullaCancellazione } from "@/app/api/account/delete/route";
import { GET as scaricaDati } from "@/app/api/account/export/route";
import { POST as scriviAiContatti } from "@/app/api/contact/route";
import { recapitoDallaRisposta } from "@/lib/legal/titolare";

beforeEach(preparaLaProva);

afterEach(() => {
  vi.useRealTimers();
});

describe("senza la chiave di servizio nessuna porta è murata", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  it("Cancella account dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX);
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo, "«Servizio non configurato» è vero per noi e un muro per lei").toContain("info@mycity-marketplace.com");
    expect(testo).not.toContain("Servizio non configurato");
    // Nell'errore serve il collegamento, non solo l'indirizzo da ricopiare.
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com\?subject=/);
  });

  it("Scarica i miei dati dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await scaricaDati(conGettone("GET", "/api/account/export") as never, CTX);
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo).toContain("info@mycity-marketplace.com");
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com/);
  });

  // 27/10/2026 (secondo giro) — Qui la prova pretendeva «si manda al modulo».
  // Ma senza chiave il modulo non salva niente, e senza posta del supporto non
  // inoltra: rispondeva «riprova tra qualche ora». Cancella account mandava al
  // modulo, il modulo non arrivava a nessuno — la persona girava in tondo.
  it("senza casella e senza posta del supporto non si manda la persona in tondo", async () => {
    const res = await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX);
    const testo = await corpo(res);
    expect(res.status).toBe(503);
    expect(testo, "il modulo, senza chiave e senza posta, non arriva a nessuno").not.toContain("/contact");
    expect(testo).not.toContain("modulo dei contatti");
    expect(testo, "nessun indirizzo inventato").not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
    expect(testo, "lo dice in chiaro: la richiesta non è partita").toContain("non è partita");
    // E il modulo, nella stessa situazione, non promette un «riprova» che non cambia niente.
    const modulo = await scriviAiContatti(messaggio("7.0.0.9"));
    expect(modulo.status).toBe(503);
    const suo = await corpo(modulo);
    expect(suo).not.toContain("Riprova");
    expect(suo, "nessun indirizzo inventato").not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
  });

  it("con la casella del supporto ma senza la posta, non si manda al modulo", async () => {
    // Il caso più probabile in produzione: SUPPORT_EMAIL c'è, Resend no. Il
    // modulo prova a inoltrare, la posta lo salta, e risponde 503.
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza posta il modulo non inoltra: mandarci la persona è il giro in tondo").not.toContain("/contact");
    expect(testo).toContain("non è partita");
    const modulo = await scriviAiContatti(messaggio("7.0.0.12"));
    expect(modulo.status).toBe(503);
  });

  it("se Cancella account manda al modulo, il modulo arriva davvero a una persona", async () => {
    // 5/11/2026 (S08, scheda 2058) — Le caselle stanno sul dominio dei contatti: su un
    // dominio altrui il modulo «arriverebbe» dove nessuno legge, e la porta non ci manda.
    process.env.SUPPORT_EMAIL = "supporto@mycity-marketplace.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@mycity-marketplace.com>";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo).toContain("/contact");
    expect(testo).not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
    inviaEmail.mockResolvedValueOnce({ ok: true, id: "e-1" } as { ok: boolean });
    const modulo = await scriviAiContatti(messaggio("7.0.0.10"));
    expect(modulo.status, "il modulo a cui l abbiamo mandata deve arrivare a qualcuno").toBe(200);
  });

  it("se il modulo non funziona e la casella c'è, l'errore porta il collegamento alla casella", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await scriviAiContatti(messaggio("7.0.0.11"));
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo).toContain("Scrivici a info@mycity-marketplace.com");
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com/);
  });

  const messaggio = (ip: string) =>
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "Maria Rossi", email: "maria@example.com", subject: "Privacy", message: "Vorrei cancellare il mio account, grazie." }),
    });

  it("il modulo dei contatti risponde 503 con una frase leggibile invece di lanciare", async () => {
    const res = await scriviAiContatti(messaggio("7.0.0.1"));
    expect(res.status).toBe(503);
    expect(await corpo(res)).toContain("non è arrivato");
  });

  it("se la posta del supporto c è, il messaggio arriva a una persona anche senza database", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    inviaEmail.mockResolvedValueOnce({ ok: true });
    const res = await scriviAiContatti(messaggio("7.0.0.2"));
    expect(res.status).toBe(200);
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(inviaEmail.mock.calls[0][0])).toContain("maria@example.com");
  });
});

describe("il collegamento accanto all'errore si fida solo di due forme", () => {
  it("passa una casella (mailto:) o il modulo; tutto il resto no", () => {
    const r = (href: unknown) => recapitoDallaRisposta({ error: { details: { recapito: { href, testo: "x" } } } });
    expect(r("mailto:info@mycity-marketplace.com?subject=Richiesta")?.href).toBe("mailto:info@mycity-marketplace.com?subject=Richiesta");
    expect(r("/contact")?.href).toBe("/contact");
    expect(r("javascript:alert(1)")).toBeNull();
    expect(r("https://altro.example/contact")).toBeNull();
    expect(r(42)).toBeNull();
    expect(recapitoDallaRisposta(null)).toBeNull();
    expect(recapitoDallaRisposta({ error: { details: { recapito: null } } })).toBeNull();
  });
});

/**
 * 27/10/2026 (quarto giro) — LE PROVE CHE MANCAVANO.
 *
 * Il collaudo del terzo giro ha trovato mutazioni che restavano verdi e
 * situazioni che nessuna prova guardava. Ogni prova qui sotto diventa rossa su
 * una di quelle; il messaggio dell'asserzione dice quale.
 */
describe("con la posta a metà, Cancella account non riapre il giro in tondo", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  it("con la chiave di Resend ma senza il mittente (RESEND_FROM) non manda al modulo", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza mittente la posta non parte: il modulo non inoltra a nessuno").not.toContain("/contact");
    expect(testo).toContain("non è partita");
  });

  it("con Resend acceso ma senza la casella del supporto (SUPPORT_EMAIL) non manda al modulo", async () => {
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza casella del supporto il modulo non sa a chi inoltrare").not.toContain("/contact");
    expect(testo).toContain("non è partita");
    const modulo = await scriviAiContatti(richiestaAlModulo("7.0.0.20"));
    expect(modulo.status, "e infatti il modulo, così, non arriva a nessuno").toBe(503);
  });
});

describe("senza casella e senza posta nessuna delle quattro porte manda in tondo", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  const porte: Array<[string, () => Promise<unknown>]> = [
    ["Cancella account", () => chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX)],
    ["Annulla la cancellazione", () => annullaCancellazione(conGettone("DELETE", "/api/account/delete") as never, CTX)],
    ["Stato della cancellazione", () => statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX)],
    ["Scarica i miei dati", () => scaricaDati(conGettone("GET", "/api/account/export") as never, CTX)],
  ];

  for (const [nome, bussa] of porte) {
    it(`${nome}: dice che la richiesta non è partita, non manda al modulo che non arriva`, async () => {
      const res = (await bussa()) as Response;
      const testo = await corpo(res);
      expect(res.status).toBe(503);
      expect(testo, "il controllo d'accesso ha risposto prima della rotta").not.toContain("Auth non configurato");
      expect(testo, "senza chiave e senza posta il modulo non arriva a nessuno").not.toContain("/contact");
      expect(testo).toContain("non è partita");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 27/10/2026 (quarto giro, fase 2) — LE MUTAZIONI CHE RESTAVANO VERDI.
// Ogni prova qui sotto è nata da una mutazione che passava tutta la suite: il
// commento dice quale, e la prova diventa rossa con quella mutazione.
// ─────────────────────────────────────────────────────────────────────────────
describe("la posta a metà: ogni pezzo che manca, o che c'è ma è vuoto, chiude la strada del modulo", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  // Mutazione: togliere RESEND_API_KEY da ilModuloArrivaSenzaDatabase.
  it("con la casella del supporto e il mittente ma senza la chiave di Resend (RESEND_API_KEY) non manda al modulo", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza la chiave di Resend la posta non parte: il modulo non inoltra a nessuno").not.toContain("/contact");
    expect(testo).toContain("non è partita");
  });

  // Mutazione: `(v) => typeof v === 'string'` al posto del controllo «non vuota».
  for (const nome of ["SUPPORT_EMAIL", "RESEND_API_KEY", "RESEND_FROM"]) {
    for (const vuota of ["", "   "]) {
      it(`con ${nome} presente ma vuota (${JSON.stringify(vuota)}) non manda al modulo`, async () => {
        process.env.SUPPORT_EMAIL = "supporto@example.com";
        process.env.RESEND_API_KEY = "re_di_prova";
        process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
        process.env[nome] = vuota;
        const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
        expect(testo, "una variabile vuota è una variabile che manca: il modulo non inoltra").not.toContain("/contact");
        expect(testo).toContain("non è partita");
      });
    }
  }
});
