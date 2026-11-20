import type { TourStep } from './Tour.tsx';

export const CARTERA_TOUR_STEPS: TourStep[] = [
  {
    title: 'Tu cartera',
    body: <p>Aquí registras las compras, ventas y cobros de tus acciones, ETF y fondos. La cartera se calcula a partir de esas operaciones.</p>,
  },
  {
    target: ['.cartera-tabs', '.cartera-tab-select'],
    title: 'Secciones de la cartera',
    body: <>
      <p><strong>Resumen</strong> reúne la valoración y los resultados. <strong>En cartera</strong> muestra lo que tienes y <strong>Cerradas</strong>, lo que ya vendiste.</p>
      <p>En <strong>Registro</strong> puedes revisar e importar operaciones. <strong>Renta</strong> agrupa los datos fiscales por año.</p>
    </>,
  },
  {
    target: '[data-tour="operation"]',
    title: 'Añadir operaciones',
    body: <p>Registra una compra, una venta o un cobro con su fecha e importes. Las participaciones de los fondos admiten decimales.</p>,
  },
  {
    title: 'Importar operaciones',
    body: <p>En <strong>Registro → Importar operaciones</strong> puedes cargar un Excel o CSV de tu bróker. Revisa las columnas y los valores antes de confirmar. Si la cartera está vacía, también encontrarás el botón para importar en la pantalla inicial.</p>,
  },
  {
    target: '.cartera .name-btn',
    title: 'La ficha de cada valor',
    body: <p>Pulsa el nombre del valor para consultar sus operaciones y editar su ficha, incluidos su ticker, su ISIN y la cotización con la que se sigue su precio.</p>,
  },
  {
    title: 'Precios y valoración',
    body: <p>Para mostrar el precio, cada valor necesita una cotización: se busca por nombre, ISIN o ticker y se elige la bolsa. En los fondos debe corresponder a la misma clase y divisa. Si falta el precio, las operaciones se conservan y la valoración se indica como incompleta.</p>,
  },
  {
    target: '[data-tour="refresh"]',
    title: 'Actualizar cotizaciones',
    body: <p>Con la cartera en pantalla, los precios se refrescan solos cada pocos segundos. Pasa el ratón por este icono para ver el estado y púlsalo para forzar la actualización. Los precios de los fondos se actualizan una vez al día, cuando la gestora publica el valor liquidativo.</p>,
  },
  {
    target: '[data-tour="settings"]',
    title: 'Volver a la guía',
    body: <p>Puedes abrir esta guía cuando quieras desde <strong>Ajustes → General → Ver la guía</strong>. En una lista de vigilancia explica las herramientas de esa sección.</p>,
  },
];
