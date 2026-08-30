/**
 * `useProfile` in finto. Chi sta guardando la pagina lo decide la prova, con
 * `globalThis.__PROFILO__` (per esempio `{ isAuthenticated: true, isBuyer: true }`).
 * Il vero aggancio parla col servizio di autenticazione: dentro una prova non
 * risponderebbe nessuno e la pagina resterebbe per sempre «sto caricando».
 */
export function useProfile() {
  const p = globalThis.__PROFILO__ ?? {};
  return {
    profile: p.profile ?? null,
    userEmail: p.userEmail ?? null,
    isLoading: false,
    isAuthenticated: !!p.isAuthenticated,
    isBuyer: !!p.isBuyer,
    isSeller: !!p.isSeller,
    isRider: !!p.isRider,
    isAdmin: !!p.isAdmin,
  };
}
