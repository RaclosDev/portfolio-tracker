/**
 * Crea la lista nueva una sola vez por nombre. Si la importación falla después de crearla, reintentar
 * no debe crear otra lista (ni «Lista», ni «Lista (2)»): se reutiliza la que ya existe.
 */
export function listCreator(create: (name: string) => Promise<{ id: number }>) {
  let made: { name: string; id: number } | null = null;
  return async (name: string): Promise<number> => {
    if (made?.name !== name) made = { name, id: (await create(name)).id };
    return made.id;
  };
}
