/**
 * React vero, più `use`.
 *
 * Next porta con sé la sua copia di React, dove `use()` esiste; la copia in
 * `node_modules` di questa repo è la 18, dove non esiste ancora. Le pagine che
 * leggono i parametri con `use(props.params)` non si potrebbero montare in una
 * prova per questo dettaglio di versione, non per un difetto loro. Qui si
 * aggiunge solo quel pezzo: gli hook restano quelli veri, e la copia di React è
 * la stessa che usa la prova — altrimenti nessun hook funzionerebbe.
 */
export { default } from 'react';
export {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, version,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId,
  useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer,
  useRef, useState, useSyncExternalStore, useTransition,
} from 'react';

const stato = new WeakMap();

export function use(promessa) {
  if (!promessa || typeof promessa.then !== 'function') return promessa;
  const noto = stato.get(promessa);
  if (noto?.esito === 'fatto') return noto.valore;
  if (noto?.esito === 'errore') throw noto.errore;
  if (!noto) {
    const riga = { esito: 'in-corso' };
    stato.set(promessa, riga);
    promessa.then(
      (v) => { riga.esito = 'fatto'; riga.valore = v; },
      (e) => { riga.esito = 'errore'; riga.errore = e; },
    );
  }
  // Sospende: è quello che fa `use` quando la promessa non ha ancora risposto.
  throw promessa;
}
