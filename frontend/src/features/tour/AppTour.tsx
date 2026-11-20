import { CARTERA_TOUR_STEPS } from './carteraSteps.tsx';
import { TOUR_STEPS } from './steps.tsx';
import { Tour } from './Tour.tsx';

/** La guía con sus pasos, en un trozo aparte: solo se descarga al abrirla. */
export default function AppTour({ portfolio, onClose }: { portfolio: boolean; onClose: () => void }) {
  return <Tour steps={portfolio ? CARTERA_TOUR_STEPS : TOUR_STEPS} onClose={onClose} />;
}
