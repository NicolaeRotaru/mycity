'use client';

import RimborsiDaBonificarePage from '@/app/admin/rimborsi-da-bonificare/page';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';

/**
 * Il banco di prova della lista dei bonifici da fare: la pagina VERA, con accanto il dialogo di
 * conferma che nel sito vive nel guscio di tutte le pagine (`app/layout.tsx`). Compilati
 * insieme, pagina e dialogo condividono lo stesso stato: la domanda che la pagina fa, qui si vede.
 */
export default function BancoDeiBonificiDaFare() {
  return (
    <>
      <RimborsiDaBonificarePage />
      <ConfirmDialogHost />
    </>
  );
}
