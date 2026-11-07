import { COLOR_DEFS, DEFAULT_COLORS, DEFAULT_SETTINGS, type Colors, type Settings, type WatchList } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useImportBackup, useListMutations, useUpdateSettings } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { usePrompt } from '../../components/usePrompt.tsx';
import { desktop, type DesktopPrefs } from '../../desktop.ts';
import { parseDecimal } from '../../lib/format.ts';
import { applyAppearance, applyColors } from '../../lib/theme.ts';
import { COLUMN_OPTIONS } from '../watchlist/WatchlistTable.tsx';

type Section = 'general' | 'estados' | 'aspecto' | 'notificaciones' | 'listas' | 'copias';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'estados', label: 'Estados y umbrales' },
  { id: 'aspecto', label: 'Aspecto' },
  { id: 'notificaciones', label: 'Notificaciones' },
  { id: 'listas', label: 'Listas' },
  { id: 'copias', label: 'Copias de seguridad' },
];

const COLOR_GROUPS = [...new Set(COLOR_DEFS.map((c) => c.group))];
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
  const listsM = useListMutations();
  const importM = useImportBackup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ask, promptEl] = usePrompt();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json() as Promise<{ version?: string }>),
    staleTime: Infinity,
  });

  // --- Borrador de los ajustes guardados en la base de datos (compartidos entre PCs)
  const [invest, setInvest] = useState(str(settings.defaultInvest));
  const [baseCurrency, setBaseCurrency] = useState(settings.baseCurrency);
  const [refresh, setRefresh] = useState(String(settings.refreshSeconds));
  const [near, setNear] = useState(str(settings.nearThresholdPct));
  const [far, setFar] = useState(str(settings.farThresholdPct));
  const [blink, setBlink] = useState(settings.blinkReached);
  const [theme, setTheme] = useState(settings.theme);
  const [density, setDensity] = useState(settings.density);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [hidden, setHidden] = useState<string[]>(settings.hiddenColumns);
  const [colors, setColors] = useState<Colors>({ ...DEFAULT_COLORS, ...settings.colors });

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

  // --- Preferencias de este PC (solo app de escritorio)
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  useEffect(() => {
    void desktop?.getPrefs().then(setPrefs);
  }, []);
  const setPref = <K extends keyof DesktopPrefs>(k: K, v: DesktopPrefs[K]) => setPrefs((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    setError(null);
    const nearN = parseDecimal(near) ?? settings.nearThresholdPct;
    const farN = parseDecimal(far) ?? settings.farThresholdPct;
    if (farN < nearN) {
      setSection('estados');
      return setError('El umbral de "lejos" tiene que ser mayor o igual que el de "cerca".');
    }
    const next: Partial<Settings> = {
      defaultInvest: parseDecimal(invest) ?? settings.defaultInvest,
      baseCurrency,
      refreshSeconds: Math.min(3600, Math.max(15, Math.round(parseDecimal(refresh) ?? settings.refreshSeconds))),
      nearThresholdPct: nearN,
      farThresholdPct: farN,
      blinkReached: blink,
      theme,
      density,
      fontSize,
      hiddenColumns: hidden,
      colors,
    };
    try {
      const res = await update.mutateAsync(next);
      saved.current = res;
      if (desktop && prefs) {
        await desktop.setPrefs(prefs);
      }
      onClose();
    } catch {
      setError('No se pudieron guardar los ajustes.');
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

  const nearN = parseDecimal(near) ?? 0;
  const farN = parseDecimal(far) ?? 0;

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
        <Row label="Actualizar cotizaciones cada" hint="Con la app abierta (mínimo 15 s).">
          <NumberInput label="Segundos entre actualizaciones" value={refresh} onChange={setRefresh} suffix="segundos" />
        </Row>
      </>
    ),
    estados: (
      <>
        <h3>Estados y umbrales</h3>
        <p className="intro">
          Cómo se clasifica cada nivel de compra según lo que le falta caer al precio. Afecta a los colores, las tarjetas,
          los filtros y las notificaciones.
        </p>
        <Row label="Cerca" hint="Le falta caer como mucho este porcentaje.">
          <NumberInput label="Umbral cerca" value={near} onChange={setNear} suffix="%" />
        </Row>
        <Row label="Lejos" hint="Hasta este porcentaje; por encima es «muy lejos».">
          <NumberInput label="Umbral lejos" value={far} onChange={setFar} suffix="%" />
        </Row>
        <Row label="Parpadear los valores en zona de compra" hint="Para que no se te pasen. Se desactiva si Windows tiene reducidas las animaciones.">
          <Switch label="Parpadeo" checked={blink} onChange={setBlink} />
        </Row>
        <div className="threshold-preview" aria-label="Ejemplo">
          <span className="pill pill--reached">✓ En zona</span>
          <span className="pill pill--near">Cerca: hasta −{str(nearN)} %</span>
          <span className="pill pill--far">Lejos: hasta −{str(farN)} %</span>
          <span className="pill pill--veryFar">Muy lejos: más de −{str(farN)} %</span>
        </div>
      </>
    ),
    aspecto: (
      <>
        <h3>Aspecto</h3>
        <p className="intro">Los cambios se ven al momento; si cancelas, se deshacen.</p>
        <Row label="Tema">
          <select aria-label="Tema" value={theme} onChange={(e) => setTheme(e.target.value as Settings['theme'])}>
            <option value="system">Como Windows</option>
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
        <div className="setting-row" style={{ display: 'block' }}>
          <div className="setting-row__label">
            <strong>Columnas visibles</strong>
            <span>Desmarca las que no uses. «Valor» siempre se muestra.</span>
          </div>
          <div className="columns-grid">
            {COLUMN_OPTIONS.map((c) => (
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
            <strong>Colores</strong>
            <span>Eliges uno por estado; la app ajusta fondos y textos para que se lean bien en claro y oscuro.</span>
          </div>
          <div className="color-groups" style={{ marginTop: 10 }}>
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
            <span className="pill pill--far">-11,0 %</span>
            <span className="pill pill--veryFar">-24,0 %</span>
            <span className="badge badge--order">Activa @ 64,20</span>
            <span className="badge badge--danger">Caducada</span>
            <span className="badge badge--fx">USD</span>
            <span className="delta up">+1,25 %</span>
            <span className="delta down">-0,80 %</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => {
                setColors(DEFAULT_COLORS);
                setTheme(DEFAULT_SETTINGS.theme);
                setDensity(DEFAULT_SETTINGS.density);
                setFontSize(DEFAULT_SETTINGS.fontSize);
                setHidden([]);
              }}
            >
              Restablecer aspecto
            </button>
          </div>
        </div>
      </>
    ),
    notificaciones: desktop ? (
      prefs ? (
        <>
          <h3>Notificaciones</h3>
          <p className="intro">Avisos de Windows cuando un precio llega a donde quieres. Se configuran en cada PC.</p>
          <Row label="Activar notificaciones">
            <Switch label="Activar notificaciones" checked={prefs.notifications} onChange={(v) => setPref('notifications', v)} />
          </Row>
          <Row label="En zona de compra" hint="El precio baja de alguno de tus niveles de compra.">
            <Switch label="Avisar en zona de compra" checked={prefs.notifyReached} onChange={(v) => setPref('notifyReached', v)} />
          </Row>
          <Row label="Cerca de un nivel" hint="Según el umbral de «cerca» de Estados y umbrales.">
            <Switch label="Avisar cerca" checked={prefs.notifyNear} onChange={(v) => setPref('notifyNear', v)} />
          </Row>
          <Row label="Órdenes" hint="El precio toca tu orden puesta o la orden está a punto de caducar.">
            <Switch label="Avisar de órdenes" checked={prefs.notifyOrders} onChange={(v) => setPref('notifyOrders', v)} />
          </Row>
          <Row
            label="Frecuencia"
            hint={`Los precios se comprueban cada ${refresh || settings.refreshSeconds} segundos, también en segundo plano. Se cambia en General.`}
          >
            <button type="button" className="btn btn--small" onClick={() => setSection('general')}>
              Ir a General
            </button>
          </Row>
          <Row label="No comprobar en fin de semana" hint="Los mercados están cerrados.">
            <Switch label="Saltar fin de semana" checked={prefs.skipWeekends} onChange={(v) => setPref('skipWeekends', v)} />
          </Row>
          <Row label="Horas de silencio" hint="Sin avisos en ese tramo; lo que pase se avisa al terminar.">
            <span className="input-suffix">
              <Switch label="Horas de silencio" checked={prefs.quietHours} onChange={(v) => setPref('quietHours', v)} />
              <input type="time" aria-label="Silencio desde" value={prefs.quietFrom} disabled={!prefs.quietHours} onChange={(e) => setPref('quietFrom', e.target.value)} />
              a
              <input type="time" aria-label="Silencio hasta" value={prefs.quietTo} disabled={!prefs.quietHours} onChange={(e) => setPref('quietTo', e.target.value)} />
            </span>
          </Row>
          <Row label="Resumen diario" hint="Una notificación con lo que está en zona, cerca y las órdenes por caducar.">
            <span className="input-suffix">
              <Switch label="Resumen diario" checked={prefs.dailySummary} onChange={(v) => setPref('dailySummary', v)} />
              <input type="time" aria-label="Hora del resumen" value={prefs.dailySummaryAt} disabled={!prefs.dailySummary} onChange={(e) => setPref('dailySummaryAt', e.target.value)} />
            </span>
          </Row>
          <Row label="Seguir en segundo plano al cerrar" hint="La ventana se cierra pero la app queda en la bandeja del sistema (junto al reloj) vigilando precios.">
            <Switch label="Segundo plano" checked={prefs.runInBackground} onChange={(v) => setPref('runInBackground', v)} />
          </Row>
          <Row label="Iniciar con Windows" hint="Arranca oculta en la bandeja al encender el PC.">
            <Switch label="Iniciar con Windows" checked={prefs.startWithWindows} onChange={(v) => setPref('startWithWindows', v)} />
          </Row>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => void desktop!.testNotification()}>
              Enviar notificación de prueba
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const r = await desktop!.checkNow();
                setMsg(r.alerts ? `${r.alerts} aviso(s) nuevo(s).` : 'Comprobado: nada nuevo que avisar.');
              }}
            >
              Comprobar ahora
            </button>
          </div>
          {msg && section === 'notificaciones' && (
            <p className="small" role="status">
              {msg}
            </p>
          )}
        </>
      ) : (
        <p className="muted">Cargando…</p>
      )
    ) : (
      <>
        <h3>Notificaciones</h3>
        <p className="intro">Las notificaciones solo funcionan en la app de escritorio (acceso directo «Watchlist»).</p>
      </>
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
        <h3>Copias de seguridad</h3>
        <p className="intro">
          La app guarda una copia automática cada día (carpeta «copias» dentro de la de datos) y otra antes de cada
          importación. Aquí puedes exportar tus datos a un fichero o cargar uno.
        </p>
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
        {desktop && (
          <div className="row-actions">
            <button type="button" className="btn btn--small" onClick={() => void desktop!.openLogs()}>
              Abrir carpeta de registros
            </button>
            <span className="muted small">Para revisar qué ha pasado si algo falla.</span>
          </div>
        )}
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
          {error && (
            <span className="error-text small" role="alert">
              {error}
            </span>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={update.isPending}>
            Guardar
          </button>
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
    </Dialog>
  );
}
