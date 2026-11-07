import { COLOR_DEFS, DEFAULT_COLORS, type Colors, type Settings, type WatchList } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useImportBackup, useListMutations, useUpdateSettings } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { parseDecimal } from '../../lib/format.ts';
import { applyColors } from '../../lib/theme.ts';
import { usePrompt } from '../../components/usePrompt.tsx';

const COLOR_GROUPS = [...new Set(COLOR_DEFS.map((c) => c.group))];

interface Props {
  settings: Settings;
  lists: WatchList[];
  onClose: () => void;
}

export function SettingsDialog({ settings, lists, onClose }: Props) {
  const [invest, setInvest] = useState(String(settings.defaultInvest));
  const [near, setNear] = useState(String(settings.nearThresholdPct).replace('.', ','));
  const [refresh, setRefresh] = useState(String(settings.refreshSeconds));
  const [msg, setMsg] = useState<string | null>(null);
  const update = useUpdateSettings();
  const listsM = useListMutations();
  const importM = useImportBackup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ask, promptEl] = usePrompt();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json() as Promise<{ version?: string }>),
    staleTime: Infinity,
  });

  // Colores: se previsualizan en vivo; si se cancela, se restauran los guardados.
  const [colors, setColors] = useState<Colors>({ ...DEFAULT_COLORS, ...settings.colors });
  const savedColors = useRef(settings.colors);
  useEffect(() => applyColors(colors), [colors]);
  useEffect(() => () => applyColors(savedColors.current), []);
  const isDefault = COLOR_DEFS.every((c) => colors[c.key].toLowerCase() === c.default);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      defaultInvest: parseDecimal(invest) ?? settings.defaultInvest,
      nearThresholdPct: parseDecimal(near) ?? settings.nearThresholdPct,
      refreshSeconds: Math.max(15, Math.round(parseDecimal(refresh) ?? settings.refreshSeconds)),
      colors,
    });
    savedColors.current = colors;
    onClose();
  };

  const onImport = async (file: File) => {
    if (
      !confirm(
        'Importar REEMPLAZA todas las listas y valores de este PC por los del fichero.\n\n' +
          'Antes se guarda automáticamente una copia de lo actual en la carpeta "copias".\n\n¿Continuar?',
      )
    )
      return;
    try {
      const res = await importM.mutateAsync(JSON.parse(await file.text()));
      setMsg(
        `Importadas ${res.lists} listas con ${res.items} valores.` +
          (res.savedTo ? ` Lo que había antes se ha guardado en ${res.savedTo}` : ''),
      );
    } catch {
      setMsg('El fichero no es una copia válida.');
    }
  };

  return (
    <Dialog
      title="Ajustes"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="settings-form" className="btn btn--primary" disabled={update.isPending}>
            Guardar
          </button>
        </>
      }
    >
      <form id="settings-form" className="form" onSubmit={submit}>
        <fieldset className="form__section">
          <legend>Cálculos</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="s-inv">Importe por defecto ({settings.baseCurrency})</label>
              <input id="s-inv" inputMode="decimal" value={invest} onChange={(e) => setInvest(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="s-near">Umbral "cerca" (%)</label>
              <input id="s-near" inputMode="decimal" value={near} onChange={(e) => setNear(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="s-ref">Refresco (segundos)</label>
              <input id="s-ref" inputMode="numeric" value={refresh} onChange={(e) => setRefresh(e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form__section">
          <legend>Colores</legend>
          <div className="color-groups">
            {COLOR_GROUPS.map((group) => (
              <div key={group} className="color-group">
                <h4>{group}</h4>
                <div className="color-grid">
                  {COLOR_DEFS.filter((c) => c.group === group).map((c) => (
                    <label key={c.key} className="color-field">
                      <input
                        type="color"
                        value={colors[c.key]}
                        onChange={(e) => setColors((prev) => ({ ...prev, [c.key]: e.target.value }))}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="color-preview" aria-label="Vista previa">
            <span className="pill pill--reached">✓ -1,2 %</span>
            <span className="pill pill--near">-3,4 %</span>
            <span className="pill pill--far">-18,0 %</span>
            <span className="badge badge--order">Activa @ 64,20</span>
            <span className="badge badge--danger">Caducada</span>
            <span className="badge badge--fx">USD</span>
            <span className="delta up">+1,25 %</span>
            <span className="delta down">-0,80 %</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--small btn--ghost"
              disabled={isDefault}
              onClick={() => setColors(DEFAULT_COLORS)}
            >
              Restablecer colores
            </button>
          </div>
        </fieldset>
      </form>

      <section className="form__section">
        <h3 className="section-title">Listas</h3>
        <ul className="list-admin">
          {lists.map((l) => (
            <li key={l.id}>
              <span>
                {l.name} <span className="muted">({l.itemCount})</span>
              </span>
              <span className="list-admin__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={async () => {
                    const name = await ask('Renombrar lista', 'Nuevo nombre', l.name);
                    if (name) listsM.rename.mutate({ id: l.id, name });
                  }}
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--danger-ghost"
                  disabled={lists.length <= 1}
                  onClick={() => {
                    if (confirm(`¿Borrar la lista "${l.name}" y sus ${l.itemCount} valores?`)) listsM.remove.mutate(l.id);
                  }}
                >
                  Borrar
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="form__section">
        <h3 className="section-title">Copia de seguridad</h3>
        <p className="muted small">Todos los datos se guardan solo en este ordenador. Exporta una copia para llevarla a otro PC.</p>
        <div className="row-actions">
          <a className="btn" href="/api/backup" download>
            Exportar JSON
          </a>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={importM.isPending}>
            Importar JSON…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {msg && (
          <p className="small" role="status">
            {msg}
          </p>
        )}
      </section>
      <p className="muted small">Versión: {health.data?.version ?? '—'}</p>
      {promptEl}
    </Dialog>
  );
}
