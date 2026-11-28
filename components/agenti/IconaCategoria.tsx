import { Apple, Beef, CakeSlice, Coffee, Croissant, Gift, Hammer, Milk, Scissors, Store, type LucideIcon } from 'lucide-react';
import type { Categoria } from '@/lib/agenti/clienti-vista';

/** L'icona di ogni categoria della mappa dei clienti (lucide-react, come il resto del sito). */
export const ICONE: Record<Categoria, LucideIcon> = {
  panetteria: Croissant,
  macelleria: Beef,
  frutta: Apple,
  formaggi: Milk,
  pasticceria: CakeSlice,
  regali: Gift,
  persona: Scissors,
  ristoro: Coffee,
  artigiani: Hammer,
  altri: Store,
};
