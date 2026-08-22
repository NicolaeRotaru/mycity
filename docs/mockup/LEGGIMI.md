# Mockup, non codice

**I componenti vivi stanno in `components/ui/`.** Qui dentro non c'è niente che
il sito esegua: è il repertorio visivo da cui i componenti veri sono stati
disegnati.

## Perché questa cartella si è spostata

Fino al 22/8/2026 stava nella radice del progetto e si chiamava `design-system`.
Due problemi.

Il primo: il nome prometteva codice. Chi lo leggeva nell'elenco delle cartelle
si aspettava la libreria di componenti del sito, e la cercava lì.

Il secondo, più concreto: dentro `components/core/` c'erano copie in `.jsx` di
`Button`, `Card` e `Badge` — gli stessi identici nomi dei componenti veri, che
vivono in `components/ui/` e sono scritti in `.tsx`. Cercando «Button» ne
uscivano due, e nessuno dei due diceva quale fosse quello che gira. Quelle copie
sono state cancellate: erano ferme a una versione vecchia, e il valore di questa
cartella non è mai stato quello.

## Cosa vale la pena tenere

- `ui_kits/` — i mockup veri, quelli che i commenti nel codice citano davvero
  (per esempio `ui_kits/seller/src/30-orders.txt`).
- `tokens/`, `styles.css`, `guidelines/` — il linguaggio visivo di riferimento.
- `deck/`, `assets/` — materiale di presentazione.

## Una regola

Se un componente qui dentro e uno in `components/ui/` non vanno d'accordo,
**ha ragione `components/ui/`**: è quello che le persone vedono.
