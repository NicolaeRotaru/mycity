/**
 * @vitest-environment jsdom
 */
/**
 * R09-011 — un social scritto male non deve bloccare la vetrina senza dire dove.
 * Il link copiato dall'app (con ?igsh=) si corregge da solo; quello che non si corregge
 * scrive l'errore SOTTO il campo giusto, apre la sezione «Social e contatti» (anche se era
 * chiusa) e non la richiude mentre si scrive; scrivendo in un campo si toglie solo il suo errore.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { normalizzaSocials, erroriPerCampoSocial, storeCustomizationSchema } from "@/lib/store-customization";

vi.mock("@/components/StoreLocationPickerLazy", () => ({ default: () => null }));
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
vi.mock("@/components/seller/AccentPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/CoverPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/AnnouncementEditor", () => ({ default: () => null }));
vi.mock("@/components/seller/BadgePicker", () => ({ default: () => null }));
vi.mock("@/components/seller/StoreHoursEditor", () => ({ default: () => null }));
vi.mock("@/components/seller/FeaturedProductsPicker", () => ({ default: () => null }));

import VendorForm from "@/components/VendorForm";

describe("R09-011 — il link dell'app si corregge da solo", () => {
  it("?igsh=, #… e percorso dopo il nome non bloccano più", () => {
    const s = normalizzaSocials({
      instagram: "https://www.instagram.com/panequotidiano/?igsh=MWx4b3Q3",
      facebook: "https://www.facebook.com/panequotidiano?mibextid=abc",
      tiktok: "https://www.tiktok.com/@forno?lang=it",
    });
    expect(s).toMatchObject({ instagram: "panequotidiano", facebook: "panequotidiano", tiktok: "forno" });
    expect(storeCustomizationSchema.safeParse({ socials: s }).success).toBe(true);
  });
  it("erroriPerCampoSocial dà il primo messaggio di ogni campo", () => {
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: "Pane Quotidiano", website: "x" } });
    expect(r.success).toBe(false);
    const e = erroriPerCampoSocial(!r.success ? r.error.issues : []);
    expect(Object.keys(e).sort()).toEqual(["facebook", "website"]);
  });
});

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function monta(socials: Record<string, string>, onSubmit = vi.fn()) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement("div");
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(VendorForm as never, {
      mode: "branding", onSubmit,
      defaultValues: { storeName: "Forno Bello", storeCustomization: { socials } },
    }));
  });
  await aspetta();
  return { radice, onSubmit };
}
const invia = async (radice: HTMLElement) => {
  await act(async () => { radice.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await aspetta();
};
const scrivi = async (el: HTMLInputElement, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const sezioneSocial = (radice: HTMLElement) =>
  Array.from(radice.querySelectorAll("details")).find((d) => d.textContent?.includes("Social e contatti"))! as HTMLDetailsElement;

describe("R09-011 — l'errore sta sotto il campo giusto", () => {
  it("campo sbagliato: niente salvataggio, messaggio sotto il campo, sezione aperta", async () => {
    const { radice, onSubmit } = await monta({ facebook: "Pane Quotidiano Piacenza", instagram: "forno" });
    expect(sezioneSocial(radice).open).toBe(false);
    await invia(radice);
    expect(onSubmit).not.toHaveBeenCalled();
    const err = radice.querySelector("#social-facebook-errore");
    expect(err?.textContent).toContain("Facebook");
    expect(err?.textContent).toContain("per esempio panequotidiano");
    expect(radice.querySelector("#social-instagram-errore")).toBeNull();
    expect(sezioneSocial(radice).open).toBe(true);
  });

  it("scrivendo in un altro campo l'errore resta e la sezione non si richiude; correggendo il suo, sparisce", async () => {
    const { radice, onSubmit } = await monta({ facebook: "Pane Quotidiano Piacenza", website: "x y" });
    await invia(radice);
    expect(radice.querySelector("#social-facebook-errore")).not.toBeNull();
    expect(radice.querySelector("#social-website-errore")).not.toBeNull();
    await scrivi(radice.querySelector<HTMLInputElement>("#social-instagram")!, "forno");
    expect(radice.querySelector("#social-facebook-errore")).not.toBeNull();
    expect(radice.querySelector("#social-website-errore")).not.toBeNull();
    expect(sezioneSocial(radice).open).toBe(true);
    await scrivi(radice.querySelector<HTMLInputElement>("#social-facebook")!, "panequotidiano");
    expect(radice.querySelector("#social-facebook-errore")).toBeNull();
    expect(radice.querySelector("#social-website-errore")).not.toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("con il link dell'app incollato intero la vetrina si salva", async () => {
    const { radice, onSubmit } = await monta({ instagram: "https://www.instagram.com/panequotidiano/?igsh=abc" });
    await invia(radice);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].storeCustomization.socials.instagram).toBe("panequotidiano");
  });
});
