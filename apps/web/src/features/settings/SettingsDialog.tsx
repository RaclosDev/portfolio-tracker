import {
  COLOR_DEFS,
  DEFAULT_COLORS,
  DEFAULT_SETTINGS,
  DEFAULT_STATUS_NAMES,
  DEFAULT_TAG_NAMES,
  STATUS_DEFS,
  TAG_DEFS,
  type ColorKey,
  type Colors,
  type Settings,
  type StatusNames,
  type TagNames,
  type WatchList,
} from '@watchlist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/client.ts';
import { buildModel } from '../cartera/model.ts';
import { useImportBackup, useListMutations, useUpdateSettings } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { usePrompt } from '../../components/usePrompt.tsx';
import { exportExcel, readSpreadsheet, type ReadSheet } from '../../lib/excel.ts';
import { parseDecimal } from '../../lib/format.ts';
import { ImportDialog } from '../import/ImportDialog.tsx';
import { BandsEditor } from './BandsEditor.tsx';
import { NotificationsPanel } from './NotificationsPanel.tsx';
import { applyAppearance, applyColors } from '../../lib/theme.ts';
import { COLUMN_OPTIONS } from '../watchlist/WatchlistTable.tsx';

type Section = 'general' | 'estados' | 'etiquetas' | 'tema' | 'columnas' | 'colores' | 'notificaciones' | 'listas' | 'copias';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'estados', label: 'Estados y umbrales' },
  { id: 'etiquetas', label: 'Etiquetas' },
  { id: 'tema', label: 'Tema y tamaño' },
  { id: 'columnas', label: 'Columnas' },
  { id: 'colores', label: 'Colores' },
  { id: 'notificaciones', label: 'Notificaciones' },
  { id: 'listas', label: 'Listas' },
  { id: 'copias', label: 'Copias y Excel' },
];

/** Los colores de estados y etiquetas se eligen en su propio apartado; aquí quedan los demás. */
const OTHER_COLOR_GROUPS: string[] = [...new Set<string>(COLOR_DEFS.map((c) => c.group))].filter((g) => g !== 'Estados' && g !== 'Etiquetas');
const keysOf = (groups: string[]) => COLOR_DEFS.filter((c) => groups.includes(c.group)).map((c) => c.key);
const pickDefaults = (keys: ColorKey[]) => Object.fromEntries(keys.map((k) => [k, DEFAULT_COLORS[k]])) as Partial<Colors>;

/** Etiquetas de las filas: color y, si lo tiene, nombre. */
const TAG_ROWS: { color: ColorKey; name?: keyof TagNames; label: string; hint: string }[] = [
  { color: 'equity', name: 'equity', label: 'Acción', hint: 'Tipo de valor' },
  { color: 'etf', name: 'etf', label: 'ETF', hint: 'Tipo de valor' },
  { color: 'base', label: 'Divisa base', hint: 'Cotiza en tu divisa' },
  { color: 'fx', label: 'Otra divisa', hint: 'USD, GBP…' },
  { color: 'order', label: 'Orden activa', hint: 'Orden puesta en el banco' },
  { color: 'expired', label: 'Orden caducada', hint: 'Ya pasó su fecha' },
  { color: 'muted', name: 'muted', label: 'Sin avisos', hint: 'Avisos silenciados' },
];

const TAG_CLASS: Partial<Record<ColorKey, string>> = {
  equity: 'badge--equity',
  etf: 'badge--etf',
  fx: 'badge--fx',
  order: 'badge--order',
  expired: 'badge--danger',
  muted: 'badge--muted',
};
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

interface Props {
  settings: Settings;
  lists: WatchList[];
  onClose: () => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-row__label">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

function NumberInput({ value, onChange, suffix, label }: { value: string; onChange: (v: string) => void; suffix: string; label: string }) {
  return (
    <span className="input-suffix">
      <input inputMode="decimal" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {suffix}
    </span>
  );
}

const str = (n: number) => String(n).replace('.', ',');

export function SettingsDialog({ settings, lists, onClose }: Props) {
  const [section, setSection] = useState<Section>('general');
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const listsM = useListMutations();
  const importM = useImportBackup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ask, promptEl] = usePrompt();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: authRequired } = useQuery({
    queryKey: ['session'],
    queryFn: api.session,
    staleTime: Infinity,
    select: (session) => session.authRequired,
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => window.location.reload(),
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json() as Promise<{ version?: string }>),
    staleTime: Infinity,
  });

  // --- Borrador de los ajustes guardados en la base de datos (compartidos entre PCs)
  const [invest, setInvest] = useState(str(settings.defaultInvest));
  const [baseCurrency, setBaseCurrency] = useState(settings.baseCurrency);
  const [refresh, setRefresh] = useState(String(settings.refreshSeconds));
  const [bands, setBands] = useState(settings.bands);
  const [names, setNames] = useState<StatusNames>(settings.statusNames);
  const [tagNames, setTagNames] = useState<TagNames>(settings.tagNames ?? DEFAULT_TAG_NAMES);
  const [blink, setBlink] = useState(settings.blinkReached);
  const [theme, setTheme] = useState(settings.theme);
  const [density, setDensity] = useState(settings.density);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [hidden, setHidden] = useState<string[]>(settings.hiddenColumns);
  const [extra, setExtra] = useState<string[]>(settings.extraColumns ?? []);
  const [colors, setColors] = useState<Colors>({ ...DEFAULT_COLORS, ...settings.colors });

  const setColor = (key: ColorKey, value: string) => setColors((prev) => ({ ...prev, [key]: value }));
  const tagSample = (k: ColorKey): string => {
    if (k === 'equity' || k === 'etf' || k === 'muted') return tagNames[k].trim() || DEFAULT_TAG_NAMES[k];
    if (k === 'base') return baseCurrency;
    if (k === 'fx') return baseCurrency === 'USD' ? 'EUR' : 'USD';
    return k === 'order' ? 'Activa @ 64,20' : 'Caducada';
  };

  // Vista previa en vivo del aspecto; si se cancela, se vuelve a lo guardado.
  const saved = useRef(settings);
  useEffect(() => applyColors(colors), [colors]);
  useEffect(() => applyAppearance({ theme, density, fontSize }), [theme, density, fontSize]);
  useEffect(
    () => () => {
      applyColors(saved.current.colors);
      applyAppearance(saved.current);
    },
    [],
  );

  // --- Avisos (los manda el servidor; valen para todos los dispositivos)
  const [notif, setNotif] = useState(settings.notifications ?? DEFAULT_SETTINGS.notifications);

  // --- Copias guardadas en el servidor
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, enabled: section === 'copias' });

  const save = async () => {
    setError(null);
    if (!(bands.veryNear <= bands.near && bands.near <= bands.far)) {
      setSection('estados');
      return setError('Los límites tienen que ir de menor a mayor: muy cerca ≤ cerca ≤ lejos.');
    }
    const cleanNames = Object.fromEntries(
      STATUS_DEFS.map(({ key }) => [key, names[key].trim() || DEFAULT_STATUS_NAMES[key]]),
    ) as StatusNames;
    const cleanTags = Object.fromEntries(
      TAG_DEFS.map(({ key }) => [key, tagNames[key].trim() || DEFAULT_TAG_NAMES[key]]),
    ) as TagNames;
    const next: Partial<Settings> = {
      defaultInvest: parseDecimal(invest) ?? settings.defaultInvest,
      baseCurrency,
      refreshSeconds: Math.min(3600, Math.max(15, Math.round(parseDecimal(refresh) ?? settings.refreshSeconds))),
      bands,
      statusNames: cleanNames,
      tagNames: cleanTags,
      blinkReached: blink,
      theme,
      density,
      fontSize,
      notifications: notif,
      hiddenColumns: hidden,
      extraColumns: extra,
      colors,
    };
    try {
      const res = await update.mutateAsync(next);
      saved.current = res;
      onClose();
    } catch {
      setError('No se pudieron guardar los ajustes.');
    }
  };

  // --- Excel
  const tableRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<{ fileName: string; sheets: ReadSheet[] } | null>(null);
  const onExportExcel = async () => {
    setExporting(true);
    setMsg(null);
    try {
      const [views, cartera] = await Promise.all([Promise.all(lists.map((l) => api.watchlist(l.id))), api.portfolio()]);
      await exportExcel(views, { valuation: buildModel(cartera).valuation, operations: cartera.operations });
    } catch {
      setMsg('No se pudo crear el Excel.');
    } finally {
      setExporting(false);
    }
  };
  const onPickTable = async (file: File) => {
    setMsg(null);
    try {
      setImporting({ fileName: file.name, sheets: await readSpreadsheet(file) });
    } catch {
      setMsg('No se pudo leer el fichero. Tiene que ser un Excel .xlsx o un CSV.');
    }
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

  const panels: Record<Section, ReactNode> = {
    general: (
      <>
        <h3>General</h3>
        <p className="intro">Cálculos y actualización de precios. Se guardan con tus datos y valen para todos los PCs.</p>
        <Row label="Importe a invertir por defecto" hint="Se usa en los valores que no tienen un importe propio.">
          <NumberInput label="Importe por defecto" value={invest} onChange={setInvest} suffix={baseCurrency} />
        </Row>
        <Row label="Divisa base" hint="Importes y diferencias se muestran convertidos a esta divisa.">
          <select aria-label="Divisa base" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Row>
        <Row label="Actualizar cotizaciones cada" hint="Con la web abierta (mínimo 15 s). Los avisos se comprueban como mucho cada minuto.">
          <NumberInput label="Segundos entre actualizaciones" value={refresh} onChange={setRefresh} suffix="segundos" />
        </Row>
      </>
    ),
    estados: (
      <>
        <h3>Estados y umbrales</h3>
        <p className="intro">
          Cómo se clasifica cada nivel de compra según lo que le falta caer al precio. Afecta a los colores, los filtros
          y las notificaciones. Pulsa el cuadro de color para cambiarlo y escribe encima del nombre para renombrarlo.
        </p>
        <BandsEditor bands={bands} names={names} onBands={setBands} onNames={setNames} colors={colors} onColor={setColor} />
        <div className="bands__reset">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => {
              setBands(DEFAULT_SETTINGS.bands);
              setNames(DEFAULT_STATUS_NAMES);
              setColors((c) => ({ ...c, ...pickDefaults(keysOf(['Estados'])) }));
            }}
          >
            Volver a 5 · 10 · 20 % con los nombres y colores de serie
          </button>
        </div>
        <Row label="Parpadear los valores en zona de compra" hint="Para que no se te pasen. Se desactiva si Windows tiene reducidas las animaciones.">
          <Switch label="Parpadeo" checked={blink} onChange={setBlink} />
        </Row>
      </>
    ),
    etiquetas: (
      <>
        <h3>Etiquetas</h3>
        <p className="intro">
          Las marcas pequeñas junto a cada valor. Pulsa una en la tabla para ver solo esos valores. Puedes cambiar el color
          de todas y el nombre de las que no son una divisa.
        </p>
        <div className="tag-rows">
          {TAG_ROWS.map((t) => (
            <div key={t.color} className="tag-row">
              <input
                type="color"
                className="tag-row__color"
                aria-label={`Color de la etiqueta «${t.label}»`}
                title="Cambiar el color"
                value={colors[t.color]}
                onChange={(e) => setColor(t.color, e.target.value)}
              />
              <span className="tag-row__label">
                {t.label}
                <small>{t.hint}</small>
              </span>
              {t.name ? (
                <input
                  type="text"
                  className="tag-row__name"
                  aria-label={`Nombre de la etiqueta «${t.label}»`}
                  maxLength={16}
                  value={tagNames[t.name]}
                  placeholder={DEFAULT_TAG_NAMES[t.name]}
                  onChange={(e) => setTagNames((n) => ({ ...n, [t.name!]: e.target.value }))}
                />
              ) : (
                <span />
              )}
              <span className={`badge ${TAG_CLASS[t.color] ?? ''}`}>{tagSample(t.color)}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => {
            setTagNames(DEFAULT_TAG_NAMES);
            setColors((c) => ({ ...c, ...pickDefaults(keysOf(['Etiquetas'])) }));
          }}
        >
          Volver a los nombres y colores de serie
        </button>
      </>
    ),
    tema: (
      <>
        <h3>Tema y tamaño</h3>
        <p className="intro">Los cambios se ven al momento; si cancelas, se deshacen.</p>
        <Row label="Tema">
          <select aria-label="Tema" value={theme} onChange={(e) => setTheme(e.target.value as Settings['theme'])}>
            <option value="system">Como el dispositivo</option>
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </select>
        </Row>
        <Row label="Densidad de la tabla">
          <select aria-label="Densidad" value={density} onChange={(e) => setDensity(e.target.value as Settings['density'])}>
            <option value="compact">Compacta</option>
            <option value="normal">Normal</option>
            <option value="comfortable">Amplia</option>
          </select>
        </Row>
        <Row label="Tamaño de letra">
          <select aria-label="Tamaño de letra" value={fontSize} onChange={(e) => setFontSize(e.target.value as Settings['fontSize'])}>
            <option value="small">Pequeña</option>
            <option value="normal">Normal</option>
            <option value="large">Grande</option>
          </select>
        </Row>
      </>
    ),
    columnas: (
      <>
        <h3>Columnas</h3>
        <p className="intro">Qué columnas se ven en la tabla de cada lista.</p>
        <div className="setting-row" style={{ display: 'block' }}>
          <div className="setting-row__label">
            <strong>Columnas visibles</strong>
            <span>Desmarca las que no uses. «Valor» siempre se muestra.</span>
          </div>
          <div className="columns-grid">
            {COLUMN_OPTIONS.filter((c) => !c.optional).map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(c.id)}
                  onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== c.id) : [...h, c.id]))}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        <div className="setting-row" style={{ display: 'block' }}>
          <div className="setting-row__label">
            <strong>Columnas de datos</strong>
            <span>Opcionales, vienen de Yahoo Finance y se renuevan cada 12 h. Los ETF no suelen tenerlos.</span>
          </div>
          <div className="columns-grid">
            {COLUMN_OPTIONS.filter((c) => c.optional).map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={extra.includes(c.id)}
                  onChange={(e) => setExtra((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => {
            setHidden([]);
            setExtra([]);
          }}
        >
          Volver a las columnas de serie
        </button>
      </>
    ),
    colores: (
      <>
        <h3>Colores</h3>
        <p className="intro">
          Los de los estados y las etiquetas se cambian en sus apartados. La app ajusta fondos y textos para que se lean
          bien en claro y oscuro.
        </p>
        <div className="color-groups" style={{ marginTop: 10 }}>
          {OTHER_COLOR_GROUPS.map((group) => (
            <div key={group} className="color-group">
              <h4>{group}</h4>
              <div className="color-grid">
                {COLOR_DEFS.filter((c) => c.group === group).map((c) => (
                  <label key={c.key} className="color-field">
                    <input type="color" value={colors[c.key]} onChange={(e) => setColor(c.key, e.target.value)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="color-preview" aria-label="Vista previa">
          <span className="delta up">+1,25 %</span>
          <span className="delta down">-0,80 %</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setColors((c) => ({ ...c, ...pickDefaults(keysOf(OTHER_COLOR_GROUPS)) }))}
          >
            Volver a los colores de serie
          </button>
        </div>
      </>
    ),
    notificaciones: (
      <NotificationsPanel
        value={notif}
        onChange={setNotif}
        refreshSeconds={Number(refresh) || settings.refreshSeconds}
        onGoGeneral={() => setSection('general')}
        Row={Row}
        Switch={Switch}
      />
    ),
    listas: (
      <>
        <h3>Listas</h3>
        <p className="intro">Para crear una lista nueva usa «+ Lista» junto a las pestañas.</p>
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
      </>
    ),
    copias: (
      <>
        <h3>Copias de seguridad y Excel</h3>
        <p className="intro">
          Cada día se guarda una copia completa en el servidor, y otra antes de cada importación. También puedes descargar
          tus datos a un fichero o cargar uno.
        </p>
        <h4 className="settings-sub">Excel</h4>
        <p className="muted small">
          Exporta todas las listas y la cartera a un .xlsx (filas amarillas con orden puesta, en azul las de otra divisa). Al
          importar un Excel o CSV se añaden o actualizan valores en la lista que elijas, sin borrar nada.
        </p>
        <div className="row-actions" style={{ justifyContent: 'flex-start', marginBottom: 18 }}>
          <button type="button" className="btn" onClick={onExportExcel} disabled={exporting}>
            {exporting ? 'Preparando…' : 'Exportar a Excel'}
          </button>
          <button type="button" className="btn" onClick={() => tableRef.current?.click()}>
            Importar desde Excel o CSV…
          </button>
          <input
            ref={tableRef}
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickTable(f);
              e.target.value = '';
            }}
          />
        </div>
        <h4 className="settings-sub">Copias en el servidor</h4>
        {snapshots.isPending && <p className="muted small">Cargando…</p>}
        {snapshots.data?.length === 0 && <p className="muted small">Aún no hay copias: la primera se hace hoy.</p>}
        {snapshots.data && snapshots.data.length > 0 && (
          <ul className="list-admin snapshot-list">
            {snapshots.data.slice(0, 10).map((c) => (
              <li key={c.id}>
                <span>
                  {new Date(c.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                  <span className="muted small">
                    {' '}
                    · {c.reason} · {c.items} valores{c.operations ? `, ${c.operations} operaciones de cartera` : ''}
                  </span>
                </span>
                <span className="list-admin__actions">
                  <a className="btn btn--small" href={`/api/snapshots/${c.id}`} download>
                    Descargar
                  </a>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={async () => {
                      if (!confirm('Restaurar esta copia REEMPLAZA las listas, valores y cartera actuales (antes se guarda una copia de lo actual). ¿Continuar?')) return;
                      const r = await api.restoreSnapshot(c.id);
                      await qc.invalidateQueries();
                      setMsg(`Restaurada: ${r.lists} listas, ${r.items} valores y ${r.operations} operaciones de cartera.`);
                    }}
                  >
                    Restaurar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <h4 className="settings-sub">Copia completa (JSON)</h4>
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
        {msg && section === 'copias' && (
          <p className="small" role="status">
            {msg}
          </p>
        )}
        <p className="muted small" style={{ marginTop: 18 }}>
          Versión: {health.data?.version ?? '–'}
        </p>
      </>
    ),
  };

  return (
    <Dialog
      title="Ajustes"
      onClose={onClose}
      className="dialog--settings"
      footer={
        <>
          {(error || logout.isError) && (
            <span className="settings__footer-error error-text small" role="alert">
              {logout.isError ? 'No se pudo cerrar la sesión. Vuelve a intentarlo.' : error}
            </span>
          )}
          {authRequired && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError(null);
                logout.mutate();
              }}
              disabled={logout.isPending || update.isPending}
            >
              {logout.isPending ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          )}
          <div className="settings__footer-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                logout.reset();
                void save();
              }}
              disabled={update.isPending || logout.isPending}
            >
              Guardar
            </button>
          </div>
        </>
      }
    >
      <div className="settings">
        <nav className="settings__nav" aria-label="Categorías de ajustes">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => {
                setSection(s.id);
                setMsg(null);
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings__panel">{panels[section]}</div>
      </div>
      {promptEl}
      {importing && (
        <ImportDialog
          fileName={importing.fileName}
          sheets={importing.sheets}
          lists={lists}
          defaultListId={Number(localStorage.getItem('watchlist.listId')) || null}
          defaultInvest={settings.defaultInvest}
          onClose={() => setImporting(null)}
          onDone={(_listId, message) => {
            setImporting(null);
            setMsg(message);
          }}
        />
      )}
    </Dialog>
  );
}
