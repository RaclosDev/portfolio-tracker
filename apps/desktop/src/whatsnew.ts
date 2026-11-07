/**
 * "Novedades": tras instalar una versión nueva, la primera vez que se abre la ventana se enseñan
 * los cambios desde la última versión vista, sacados de los mensajes de commit de GitHub.
 */
export interface WhatsNew {
  from: string;
  to: string;
  items: { title: string; details: string[] }[];
}

/** Commits entre dos versiones (más recientes primero). null si no hay nada que enseñar. */
export async function fetchWhatsNew(repo: string, from: string, to: string): Promise<WhatsNew | null> {
  if (!from || !to || from === to) return null;
  const res = await fetch(`https://api.github.com/repos/${repo}/compare/${from}...${to}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'watchlist-desktop-app' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { commits?: { commit: { message: string } }[] };
  const items = (data.commits ?? [])
    .map((c) => c.commit.message.split('\n'))
    .filter(([title]) => title && !title.startsWith('Merge '))
    .map(([title, ...rest]) => {
      // Viñetas "- …"; las líneas que siguen sin guion continúan la viñeta anterior.
      const details: string[] = [];
      for (const raw of rest) {
        const l = raw.trim();
        if (l.startsWith('- ')) details.push(l.slice(2));
        else if (l && details.length) details[details.length - 1] += ` ${l}`;
      }
      return { title: title!.trim(), details };
    })
    .reverse();
  return items.length ? { from, to, items } : null;
}
