import { useState, type FormEvent } from 'react';
import { Dialog } from './Dialog.tsx';

interface Request {
  title: string;
  label: string;
  initial: string;
  resolve: (value: string | null) => void;
}

/**
 * Sustituto de window.prompt() con el estilo de la app.
 * Uso: const [ask, promptEl] = usePrompt(); … const name = await ask('Título', 'Etiqueta');
 * y renderizar {promptEl}.
 */
export function usePrompt() {
  const [req, setReq] = useState<Request | null>(null);

  const ask = (title: string, label: string, initial = '') =>
    new Promise<string | null>((resolve) => setReq({ title, label, initial, resolve }));

  const finish = (value: string | null) => {
    req?.resolve(value);
    setReq(null);
  };

  const element = req ? <PromptDialog key={req.title + req.initial} req={req} onDone={finish} /> : null;
  return [ask, element] as const;
}

function PromptDialog({ req, onDone }: { req: Request; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(req.initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone(value.trim() || null);
  };
  return (
    <Dialog
      title={req.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => onDone(null)}>
            Cancelar
          </button>
          <button type="submit" form="prompt-form" className="btn btn--primary" disabled={!value.trim()}>
            Aceptar
          </button>
        </>
      }
    >
      <form id="prompt-form" className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="prompt-input">{req.label}</label>
          <input
            id="prompt-input"
            data-autofocus
            value={value}
            maxLength={60}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </div>
      </form>
    </Dialog>
  );
}
