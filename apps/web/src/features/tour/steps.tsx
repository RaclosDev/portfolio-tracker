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
    target: ['.tabs', '.list-picker'],
    title: 'Listas',
    body: (
      <p>
        Puedes tener varias listas (p. ej. "Vigilar nuevas", "Dividendos"). Cambia entre ellas con estas pestañas y crea
        una nueva con <strong>+ Lista</strong>. El número es cuántos valores tiene cada una.
      </p>
    ),
  },
  {
    target: ['[data-tour="portfolio"]', '.list-picker'],
    title: 'Cartera',
    body: (
      <>
        <p>
          Tu cartera real a partir del registro de operaciones (compras, ventas, dividendos, scrip…): lo que tienes, lo
          que ya vendiste, lo cobrado y el informe para la <strong>Renta</strong>. Puedes importar tu Excel de cartera.
        </p>
        <p>
          Cuando compres algo de esta lista, ábrelo con el lápiz y pulsa <strong>«Lo he comprado»</strong>: pasa a la
          cartera con la compra prevista ya rellenada.
        </p>
      </>
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
          puedes forzarla con <strong>Actualizar</strong>.
        </p>
        <p className="muted">
          Las bolsas europeas en Yahoo suelen ir unos 15 min retrasadas. El consenso de analistas se renueva cada 12 h.
        </p>
      </>
    ),
  },
  {
    target: '.highlights',
    title: 'Lo importante, arriba',
    body: (
      <>
        <p>
          Esta línea responde a la pregunta principal: qué valores están ya <strong>en zona de compra</strong> y, si no
          hay ninguno, cuál es el que <strong>más cerca</strong> está de tu precio. También avisa de las órdenes que
          caducan pronto.
        </p>
        <p>Pulsa un nombre para ir directamente a su fila.</p>
      </>
    ),
  },
  {
    target: '.status-filter',
    title: 'Filtrar por estado',
    body: (
      <>
        <p>
          <strong>En zona</strong>: el precio ya está por debajo de alguno de tus niveles (parpadean para que no se te
          pasen). <strong>Cerca</strong>, <strong>Lejos</strong> y <strong>Muy lejos</strong>: según lo que le falta caer;
          los porcentajes se cambian en Ajustes, Estados y umbrales. <strong>Con orden</strong>: las que tienes puestas
          en el banco.
        </p>
        <p>El número es cuántos valores hay en cada estado. Pulsa uno para filtrar y otra vez para quitarlo.</p>
      </>
    ),
  },
  {
    target: '.search',
    title: 'Buscar en la lista',
    body: <p>Filtra al momento por nombre, ticker o el texto de tus notas.</p>,
  },
  {
    target: '.tag-filters',
    title: 'Filtrar por tipo y divisa',
    body: (
      <p>
        Muestra solo <strong>acciones</strong> o solo <strong>ETF</strong>, y solo los valores en una divisa (EUR, USD…).
        También puedes pulsar directamente la etiqueta «USD» o «ETF» de cualquier fila.
      </p>
    ),
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
        <p>
          Nombre, ticker y bolsa. Las etiquetas indican la divisa (EUR, USD…; las que no son euros van en color) y el
          tipo: ACC para acciones y ETF. Pulsa una etiqueta para ver solo esos valores.
        </p>
        <p>
          <strong>Pulsa la fila</strong> para desplegar su detalle: el mapa de precios en grande o el gráfico de 1 mes a
          5 años con tus niveles, la orden y los objetivos, y todos sus datos.
        </p>
        <p>
          La franja de color a la izquierda resume la fila: <span className="tour-key tour-key--reached">verde</span> en
          zona de compra, <span className="tour-key tour-key--veryNear">verde claro</span> muy cerca,{' '}
          <span className="tour-key tour-key--near">amarillo</span> cerca y un fondo{' '}
          <span className="tour-key tour-key--order">de color</span> con orden puesta.
        </p>
      </>
    ),
  },
  {
    target: cell('price'),
    title: 'Precio actual',
    body: (
      <p>
        Última cotización y variación del día. Si aparece un triángulo de aviso junto al precio, es que no se pudo
        conectar y se muestra el último dato guardado.
      </p>
    ),
  },
  {
    target: cell('trend'),
    title: 'Tendencia de 3 meses',
    body: (
      <p>
        Cómo ha ido el precio en los últimos 3 meses: verde si sube en el periodo, naranja si baja. La línea discontinua
        es tu compra 1, para ver si se acerca o se aleja.
      </p>
    ),
  },
  {
    target: cell('map'),
    title: 'Mapa de precios',
    body: (
      <>
        <p>Se lee de izquierda (más barato) a derecha (más caro):</p>
        <ul>
          <li>La franja verde es tu <strong>zona de compra</strong>: todo lo que queda por debajo de tu compra más alta.</li>
          <li>La <strong>aguja oscura</strong> es el precio actual. Si está dentro de la franja, ya estás en tu precio.</li>
          <li>Las marcas <strong>1, 2 y 3</strong> son tus niveles de compra, con el color de su estado.</li>
          <li>La banda gris es el rango de las últimas 52 semanas, con el mínimo y el máximo anotados debajo.</li>
          <li>La marca morada es el objetivo de tu bróker y la discontinua azul, el consenso de analistas.</li>
        </ul>
        <p>Pasa el ratón por encima para ver todos los valores exactos.</p>
      </>
    ),
  },
  {
    target: cell('level0'),
    title: 'Precios de compra 1, 2 y 3',
    body: (
      <p>
        Tu precio de entrada y cuánto tiene que caer la cotización para llegar (negativo = falta caída). Pulsa el precio
        para cambiarlo ahí mismo (Enter guarda, Esc cancela). Color:{' '}
        <span className="pill pill--reached">✓ alcanzado</span> <span className="pill pill--veryNear">muy cerca</span>{' '}
        <span className="pill pill--near">cerca</span>{' '}
        <span className="pill pill--far">lejos</span> <span className="pill pill--veryFar">muy lejos</span>
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
        Pulsa el lápiz o haz doble clic en cualquier fila para cambiar niveles, objetivo, importe, orden o notas, o para quitar
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
      <>
        <p>Todo es personalizable, ordenado por categorías:</p>
        <ul>
          <li><strong>General</strong>: importe por defecto, divisa base y frecuencia de actualización.</li>
          <li><strong>Estados y umbrales</strong>: qué es cerca, lejos y muy lejos, y el parpadeo.</li>
          <li>
            <strong>Aspecto</strong>: tema claro u oscuro, densidad, tamaño de letra, colores y columnas, incluidas las
            opcionales de PER, rentabilidad por dividendo, capitalización y fechas de resultados y dividendo.
          </li>
          <li><strong>Notificaciones</strong>: avisos de Windows y segundo plano.</li>
          <li><strong>Listas</strong> y <strong>Copias de seguridad y Excel</strong>: exportar todo a .xlsx o importar desde Excel o CSV.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Avisos en el móvil y en el PC',
    body: (
      <>
        <p>
          El servidor vigila los precios todo el día, aunque no tengas la web abierta, y te avisa con una notificación cuando
          un valor entra en zona de compra, se pone cerca de un nivel, toca tu orden, la orden va a caducar o llega a tu
          objetivo de venta.
        </p>
        <p>
          Actívalas en <strong>Ajustes → Notificaciones</strong> en cada dispositivo donde quieras recibirlas. En el móvil,
          añade antes la web a la pantalla de inicio.
        </p>
      </>
    ),
  },
  {
    target: '[data-tour="tour"]',
    title: '¡Listo!',
    body: <p>Cuando quieras repasar esta explicación, pulsa «Guía» y empezará de nuevo.</p>,
  },
];
