/**
 * Aviso al borrar una lista. No se hace ninguna copia justo antes: lo único que hay es la copia diaria
 * del servidor (la última puede ser de hace horas) y las copias descargadas a mano.
 */
export const deleteListMessage = (name: string, itemCount: number) =>
  `Se borrará la lista «${name}» con sus ${itemCount} valores. No se hace una copia antes de borrarla: si te equivocas, solo podrás recuperarla desde la última copia diaria (Ajustes › Copias) o desde una copia que hayas descargado.`;
