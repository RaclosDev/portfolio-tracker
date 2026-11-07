import type { TourStep } from './Tour.tsx';

/** Celda de la primera fila de la tabla para una columna dada. */
const cell = (col: string) => `.wl-table tbody tr:first-child td.col-${col}`;

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Bienvenido a tu Watchlist',
    body: (
      <>
        <p>
          Aquí vigilas las acciones y ETF en los que quieres entrar: a qué distancia están de tus precios de compra,
          cuánto potencial les dan los analistas y cuánto invertirías.
        </p>
        <p>Te enseño cada parte en un minuto. Puedes moverte con las flechas ← → del teclado o salir con Esc.</p>
      </>
    ),
  },
  {
    target: '.tabs',
    title: 'Listas',
    body: (
      <p>
        Puedes tener varias listas (p. ej. "Vigilar nuevas", "Dividendos"). Cambia entre ellas con estas pestañas y crea
        una nueva con <strong>+ Lista</strong>. El número es cuántos valores tiene cada una.
      </p>
    ),
  },
  {
    target: '.chip',
    title: 'Tipo de cambio en vivo',
    body: (
      <p>
        Cuántos dólares (u otra divisa) vale 1 €. Se usa para calcular las acciones y pasar a euros los importes de los
        valores que cotizan en otra moneda. Ya no tienes que actualizarlo a mano.
      </p>
    ),
  },
  {
    target: '[data-tour="refresh"]',
    title: 'Actualización',
    body: (
      <>
        <p>
          Las cotizaciones se refrescan solas cada minuto (configurable en Ajustes). Aquí ves cuándo fue la última vez y
          puedes forzarla con <strong>↻ Actualizar</strong>.
        </p>
        <p className="muted">
          Las bolsas europeas en Yahoo suelen ir unos 15 min retrasadas. El consenso de analistas se renueva cada 12 h.
        </p>
      </>
    ),
  },
  {
    target: '.summary',
    title: 'Resumen y filtros rápidos',
    body: (
      <>
        <p>
          <strong>En zona de compra</strong>: el precio ya está por debajo de alguno de tus niveles.{' '}
          <strong>Cerca</strong>: le falta menos del umbral (5 % por defecto). <strong>Órdenes activas</strong>: las que
          tienes puestas en el banco y el dinero comprometido.
        </p>
        <p>Pulsa una tarjeta para filtrar la tabla; vuelve a pulsarla para quitar el filtro.</p>
      </>
    ),
  },
  {
    target: '.search',
    title: 'Buscar en la lista',
    body: <p>Filtra al momento por nombre, ticker o el texto de tus notas.</p>,
  },
  {
    target: '[data-tour="add"]',
    title: 'Añadir un valor',
    body: (
      <p>
        Abre el formulario para añadir una acción o ETF. Puedes buscar por nombre, ticker o ISIN y ver la cotización
        antes de guardar. Ahí pones tus precios de compra, el objetivo del bróker, el importe y la orden.
      </p>
    ),
  },
  {
    target: cell('name'),
    title: 'Valor',
    body: (
      <>
        <p>Nombre, ticker y bolsa. Las etiquetas indican si cotiza en otra divisa (p. ej. USD, en azul) o si es un ETF.</p>
        <p>
          La franja de color a la izquierda resume la fila: <span className="tour-key tour-key--reached">verde</span> en
          zona de compra, <span className="tour-key tour-key--near">ámbar</span> cerca y{' '}
          <span className="tour-key tour-key--order">amarillo</span> con orden puesta.
        </p>
      </>
    ),
  },
  {
    target: cell('price'),
    title: 'Precio actual',
    body: (
      <p>
        Última cotización y variación del día. Si aparece un ⚠ es que no se pudo conectar y se muestra el último dato
        guardado.
      </p>
    ),
  },
  {
    target: cell('map'),
    title: 'Mapa de precios',
    body: (
      <>
        <p>Todo de un vistazo en una sola línea:</p>
        <ul>
          <li>Barra gris: mínimo y máximo de las últimas 52 semanas.</li>
          <li>● Precio actual.</li>
          <li>▲ Tus niveles de compra (1, 2, 3): rellenos si ya se alcanzaron o están cerca.</li>
          <li>◆ Objetivo de tu bróker.</li>
          <li>| Consenso de analistas, con su rango mínimo–máximo encima.</li>
        </ul>
        <p>Pasa el ratón por encima de cada marca para ver su valor exacto.</p>
      </>
    ),
  },
  {
    target: cell('level0'),
    title: 'Precios de compra 1, 2 y 3',
    body: (
      <p>
        Tu precio de entrada y cuánto tiene que caer la cotización para llegar (negativo = falta caída). Color:{' '}
        <span className="pill pill--reached">✓ alcanzado</span> <span className="pill pill--near">cerca</span>{' '}
        <span className="pill pill--far">lejos</span>
      </p>
    ),
  },
  {
    target: cell('broker'),
    title: 'Objetivo del bróker',
    body: (
      <p>
        El precio objetivo que te da tu bróker (p. ej. Renta 4), introducido a mano, y el potencial de subida desde el
        precio actual.
      </p>
    ),
  },
  {
    target: cell('consensus'),
    title: 'Consenso de analistas',
    body: (
      <p>
        Precio objetivo medio de los analistas que cubren el valor, su potencial, cuántos analistas son y la
        recomendación media. Se obtiene automáticamente de Yahoo Finance. Los ETF no tienen consenso.
      </p>
    ),
  },
  {
    target: [cell('shares')],
    title: 'Acciones',
    body: (
      <p>
        Cuántas acciones comprarías: importe a invertir ÷ precio de entrada (con el tipo de cambio si no es en euros).
        "auto" significa que se redondea solo a la unidad superior; si fijas tú un número, debajo verás el cálculo exacto.
      </p>
    ),
  },
  {
    target: cell('net'),
    title: 'Importe y diferencia',
    body: (
      <p>
        <strong>Importe</strong>: lo que pagarías (acciones × precio de entrada), en euros y en su divisa.{' '}
        <strong>Dif.</strong>: lo que ahorras frente a comprar hoy al precio actual, en euros.
      </p>
    ),
  },
  {
    target: ['.wl-table tbody tr.row--order td.col-order', '.wl-table th.col-order'],
    title: 'Órdenes en el banco',
    body: (
      <p>
        Si tienes una orden de compra puesta, aquí ves el precio límite, hasta cuándo es válida y los días que quedan.
        Se marca en rojo cuando caduca para que la renueves o la quites.
      </p>
    ),
  },
  {
    target: cell('actions'),
    title: 'Editar',
    body: (
      <p>
        Pulsa ✎ o haz doble clic en cualquier fila para cambiar niveles, objetivo, importe, orden o notas, o para quitar
        el valor de la lista.
      </p>
    ),
  },
  {
    target: '.wl-table thead',
    title: 'Ordenar',
    body: (
      <p>
        Pulsa el título de una columna para ordenar; otra vez para invertir. Por defecto se ordena por{' '}
        <strong>Mapa de precios</strong>: lo más cercano a tus niveles de compra, arriba.
      </p>
    ),
  },
  {
    target: '[data-tour="settings"]',
    title: 'Ajustes',
    body: (
      <p>
        Importe por defecto, umbral de "cerca", frecuencia de refresco, los colores de cada estado (en zona, cerca, orden activa…), renombrar o borrar listas y hacer copias de
        seguridad (exportar/importar) para llevar tus datos a otro PC.
      </p>
    ),
  },
  {
    target: '[data-tour="tour"]',
    title: '¡Listo!',
    body: <p>Cuando quieras repasar esta explicación, pulsa este botón y el tour empezará de nuevo.</p>,
  },
];
