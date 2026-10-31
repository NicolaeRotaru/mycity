/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 — IL MODULO DEL NEGOZIO SALVAVA IL PUNTO IN CUI SI APRE LA MAPPA COME SUA POSIZIONE.
 *
 * Il modulo d iscrizione (SellerApplicationForm) e quello dei contatti (VendorForm) controllavano
 * solo che l indirizzo fosse scritto. Le coordinate erano quelle che il selettore aveva mandato
 * aprendosi: Roma, finché il negozio non premeva «Cerca». Così il negozio finiva fuori dal raggio
 * di consegna di Piacenza.
 *
 * Qui i due moduli si MONTANO e si inviano davvero; il selettore è finto e manda al modulo la
 * posizione che decide la prova. La regola: una posizione `confermata: false` non si salva, e il
 * negozio legge cosa fare. Una confermata passa (la prova di controllo, senza la quale «non ha
 * inviato» potrebbe voler dire solo che il modulo non arriva mai a inviare).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const stato = vi.hoisted(() => ({ posizione: null as null | Record<string, unknown> }));

vi.mock("@/components/StoreLocationPickerLazy", async () => {
  const { useEffect } = await import("react");
  return {
    default: function FintoSelettore({ onChange }: { onChange: (l: unknown) => void }) {
      useEffect(() => {
        if (stato.posizione) onChange(stato.posizione);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    },
  };
});
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce("a", { href: String(href), ...r }, children as never) };
});
vi.mock("@/components/StoreAvatar", () => ({ default: () => null }));
vi.mock("@/components/StoreMediaManager", () => ({ default: () => null }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock("react-dropzone", () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock("@/lib/storage/carica-immagine", () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => "" }));
vi.mock("@/components/seller/CustomizationSection", () => ({ default: () => null }));
vi.mock("@/components/seller/AccentPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/CoverPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/SocialLinksFields", () => ({ default: () => null }));
vi.mock("@/components/seller/AnnouncementEditor", () => ({ default: () => null }));
vi.mock("@/components/seller/BadgePicker", () => ({ default: () => null }));
vi.mock("@/components/seller/StoreHoursEditor", () => ({ default: () => null }));
vi.mock("@/components/seller/FeaturedProductsPicker", () => ({ default: () => null }));

import SellerApplicationForm from "@/components/SellerApplicationForm";
import VendorForm from "@/components/VendorForm";

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  stato.posizione = null;
});

const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function invia(componente: unknown, props: Record<string, unknown>, spunta: boolean) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement("div");
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(componente as never, props)); });
  await aspetta();
  if (spunta) {
    for (const c of Array.from(radice.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
      if (!c.checked) act(() => c.click());
    }
  }
  const form = radice.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await aspetta();
  return radice;
}

const SCRITTO_SENZA_CERCA = { address: "Via Roma 10, Piacenza", lat: 45.0532, lng: 9.6914, confermata: false };
const CERCATO = { address: "Via Roma 10, Piacenza", lat: 45.06, lng: 9.7, confermata: true };

const ISCRIZIONE = {
  contactEmail: "forno@esempio.it", contactPhone: "3331234567",
  legalFirstName: "Mario", legalLastName: "Rossi", legalFiscalCode: "RSSMRA80A01G535X",
  legalBirthDate: "1980-01-01", legalResidenceAddr: "Via Roma 1", legalResidenceCity: "Piacenza",
  legalResidenceZip: "29121",
  // 31/10/2026 (ondata 4): il modulo ora chiede i dati dell'impresa.
  businessLegalName: "Forno Bello di Mario Rossi", businessVatNumber: "01234567897",
  businessAddress: "Via Roma 10", businessCity: "Piacenza", businessZip: "29121",
  storeName: "Forno Bello", storeDescription: "", billingIban: "",
  storeAddress: "Via Roma 10, Piacenza",
};
const CONTATTI = { storeName: "Forno Bello", storePhone: "3331234567", storeAddress: "Via Roma 10, Piacenza" };

describe("il modulo d iscrizione del negozio", () => {
  it("non manda la richiesta con una posizione mai data, e dice cosa fare", async () => {
    stato.posizione = SCRITTO_SENZA_CERCA;
    const onSubmit = vi.fn();
    const radice = await invia(SellerApplicationForm, { defaultValues: ISCRIZIONE, onSubmit }, true);
    expect(onSubmit, "il negozio veniva salvato nel punto in cui si apre la mappa").not.toHaveBeenCalled();
    expect(radice.textContent).toContain("Metti il negozio sulla mappa");
  });

  it("con la posizione cercata la richiesta parte, con quelle coordinate", async () => {
    stato.posizione = CERCATO;
    const onSubmit = vi.fn();
    await invia(SellerApplicationForm, { defaultValues: ISCRIZIONE, onSubmit }, true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ storeLat: 45.06, storeLng: 9.7 });
  });
});

describe("il modulo dei contatti del negozio", () => {
  it("non salva una posizione mai data, e dice cosa fare", async () => {
    stato.posizione = SCRITTO_SENZA_CERCA;
    const onSubmit = vi.fn();
    const radice = await invia(VendorForm, { defaultValues: CONTATTI, onSubmit, mode: "contact" }, false);
    expect(onSubmit, "il negozio veniva salvato nel punto in cui si apre la mappa").not.toHaveBeenCalled();
    expect(radice.textContent).toContain("Metti il negozio sulla mappa");
  });

  it("con la posizione cercata salva, con quelle coordinate", async () => {
    stato.posizione = CERCATO;
    const onSubmit = vi.fn();
    await invia(VendorForm, { defaultValues: CONTATTI, onSubmit, mode: "contact" }, false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ storeLat: 45.06, storeLng: 9.7 });
  });
});
