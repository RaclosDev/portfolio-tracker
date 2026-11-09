import { DEFAULT_TAG_NAMES, type TagKey } from '@watchlist/shared';
import { useSettings } from '../api/hooks.ts';

/** Nombre de una etiqueta tal como lo haya personalizado el usuario en Ajustes → Etiquetas. */
export function TagName({ k }: { k: TagKey }) {
  return <>{(useSettings().data?.tagNames ?? DEFAULT_TAG_NAMES)[k]}</>;
}
