import type { Db } from './database.ts';

/** El esquema se obtiene del registro de cuentas, nunca de parámetros de la petición. */
export function schemaDatabase(root: Db, schema: string): Db {
  if (!/^(public|watchlist_auth|account_[a-f0-9]{32})$/.test(schema)) throw new Error('Esquema de cuenta no válido');
  const tx: Db['tx'] = (fn) => root.tx(async (db) => {
    // Sin fallback a public: una tabla ausente nunca debe resolver a datos del propietario.
    await db.query("SELECT set_config('search_path', $1, true)", [schema]);
    return fn(db);
  });
  return {
    query: (sql, params) => tx((db) => db.query(sql, params)),
    one: (sql, params) => tx((db) => db.one(sql, params)),
    exec: (sql) => tx((db) => db.exec(sql)),
    tx,
    close: async () => {},
  };
}
