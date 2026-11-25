import { HoverInfo } from '../../components/HoverInfo.tsx';

/*
 * Nota de un valor en la tabla. En el escritorio, un icono: la nota se ve al pasar el ratón o al
 * pulsarlo (popover nativo: Escape y clic fuera la cierran). En la tarjeta del móvil se ve el texto
 * entero, que allí sí cabe.
 */
export function NoteCell({ note }: { note: string }) {
  return (
    <HoverInfo icon="note" label="Ver nota" inline={note} className="note-btn">
      {note}
    </HoverInfo>
  );
}
