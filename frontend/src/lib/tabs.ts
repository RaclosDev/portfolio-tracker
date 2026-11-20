import type { KeyboardEvent } from 'react';

/**
 * Teclado de un `role="tablist"`: flechas, Inicio y Fin mueven el foco entre pestañas y activan la
 * que lo recibe. Las pestañas no elegidas llevan `tabIndex={-1}`, así Tab salta directo al panel.
 */
export function tabListKeys(e: KeyboardEvent<HTMLElement>) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
  const next = moves[e.key];
  if (i < 0 || next == null) return;
  e.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length]!;
  tab.focus();
  tab.click();
}
