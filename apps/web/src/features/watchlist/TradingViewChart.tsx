interface Props {
  /** Símbolo en formato de TradingView (BME:SAN, NVDA…). */
  symbol: string;
  name: string;
}

const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

/**
 * Gráfico de TradingView incrustado. Es el widget público: TradingView no deja incrustar el gráfico de la
 * cuenta, así que los dibujos guardados solo se ven al abrirlo en su web con el enlace de abajo.
 */
export function TradingViewChart({ symbol, name }: Props) {
  const query = new URLSearchParams({
    symbol,
    interval: 'D',
    theme: isDark() ? 'dark' : 'light',
    style: '1',
    locale: 'es',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hide_side_toolbar: '0',
    allow_symbol_change: '0',
    saveimage: '0',
    withdateranges: '1',
  });
  return (
    <div className="xp-tv">
      <iframe
        key={symbol}
        className="xp-tv__frame"
        title={`Gráfico de TradingView de ${name}`}
        src={`https://s.tradingview.com/widgetembed/?${query}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        allowFullScreen
      />
      <p className="muted small xp-tv__note">
        Lo que dibujes aquí no se guarda.{' '}
        <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
          Abrir en TradingView
        </a>{' '}
        para verlo con tu cuenta y tus dibujos guardados.
      </p>
    </div>
  );
}
