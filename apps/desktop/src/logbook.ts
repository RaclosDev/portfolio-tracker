/**
 * Registro de la app en un fichero que se conserva entre arranques (antes solo había uno en
 * %TEMP% que se sobrescribía). Rota al pasar de 1 MB, guardando la versión anterior como .1.
 * Instalada: <carpeta de instalación>\registro. En desarrollo: la carpeta de registros de Electron.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;

export class Logbook {
  readonly file: string;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'watchlist.log');
  }

  write(line: string) {
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > MAX_BYTES) {
        fs.renameSync(this.file, `${this.file}.1`);
      }
      fs.appendFileSync(this.file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* el registro nunca debe tumbar la app */
    }
  }
}
