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
    body: <p>Pulsa el nombre del valor para consultar sus operaciones y editar su ficha, incluido el símbolo con el que se busca su cotización en Yahoo.</p>,
  },
  {
    title: 'Precios y valoración',
    body: <p>Para mostrar el precio, cada valor necesita una cotización disponible en Yahoo. En los fondos debe corresponder a la misma clase y divisa. Si falta el precio, las operaciones se conservan y la valoración se indica como incompleta.</p>,
  },
  {
    target: '[data-tour="refresh"]',
    title: 'Actualizar cotizaciones',
    body: <p>Pulsa <strong>Actualizar</strong> para consultar los últimos datos disponibles. Los precios de los fondos dependen de las actualizaciones que publique Yahoo.</p>,
  },
  {
    target: '[data-tour="tour"]',
    title: 'Volver a la guía',
    body: <p>Puedes abrir esta guía cuando quieras. En una lista de vigilancia, el mismo botón explica las herramientas de esa sección.</p>,
  },
];
