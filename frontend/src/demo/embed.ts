/**
 * La portada enseña la demo dentro de un marco (`/demo?vista=…`). Ahí la app no debe tocar el localStorage
 * compartido con la app de verdad (pantalla abierta, pestaña, ordenaciones, tours…): usa una copia en memoria
 * que se tira al cerrar, y arranca en la pantalla que pide la portada, sin tour ni avisos.
 */
// La vigilancia abre «Mi vigilancia», que mezcla valores españoles y estadounidenses.
const VIEWS = {
  watchlist: { page: 'lista', list: '4' },
  portfolio: { page: 'cartera', tab: 'resumen' },
  positions: { page: 'cartera', tab: 'abiertas' },
  operations: { page: 'cartera', tab: 'registro' },
} as const;

export type EmbedView = keyof typeof VIEWS;

const params = window.location.pathname.startsWith('/demo') ? new URLSearchParams(window.location.search) : null;
const requested = params?.get('vista') ?? null;

export const EMBED = requested !== null && requested in VIEWS && window.parent !== window;

/**
 * Tema que pide quien incrusta la demo (`&tema=oscuro` o `&tema=claro`), para que case con su página.
 * Sin él, la demo sigue el tema del visitante.
 */
const THEMES = { oscuro: 'dark', claro: 'light' } as const;
const theme = params?.get('tema') ?? '';
export const EMBED_THEME = EMBED && theme in THEMES ? THEMES[theme as keyof typeof THEMES] : null;

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  constructor(seed: Storage) {
    for (let i = 0; i < seed.length; i++) {
      const key = seed.key(i);
      if (key !== null) this.data.set(key, seed.getItem(key) ?? '');
    }
  }
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

if (EMBED) {
  // Copia de lo guardado (tema, icono…) para que se vea como la app del visitante; lo que se escriba se queda aquí.
  const memory = new MemoryStorage(window.localStorage);
  const view = VIEWS[requested as EmbedView];
  memory.setItem('watchlist.pagina', view.page);
  if ('list' in view) memory.setItem('watchlist.listId', view.list);
  if ('tab' in view) memory.setItem('watchlist.cartera.pestana', view.tab);
  memory.setItem('watchlist.tourSeen', '1');
  memory.setItem('watchlist.cartera.tourSeen', '1');
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memory });
  document.documentElement.classList.add('is-embed');
  if (EMBED_THEME) document.documentElement.dataset.theme = EMBED_THEME; // desde el primer pintado
}
