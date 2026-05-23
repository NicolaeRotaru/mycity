import { redirect } from 'next/navigation';

// /seller non ha una pagina propria: la dashboard vera è in /seller/dashboard.
// Questo redirect copre i link esterni e i fallback (es. il layout seller
// che redirige a /seller se non autenticato, o link interni storici).
export default function SellerIndex() {
  redirect('/seller/dashboard');
}
