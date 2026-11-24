import { useToast } from '../app/toastContext.js';
import { currencies } from '../features/expenses/draft.js';
import { usePreferenceActions } from '../features/settings/preferences.js';

// Selector compartido UYU / USD / EUR (RF-021) para Resumen, Estadísticas y Presupuestos.
// Cambiar la moneda de consulta nunca modifica la moneda original de los gastos.
// Los cambios se serializan: mientras uno está en curso los botones quedan inactivos.
export function CurrencySelect({ current }) {
  const { currency } = usePreferenceActions();
  const toast = useToast();
  const pending = currency.isPending;
  return (
    <div className="currency-select">
      <div className="segments currencies" role="group" aria-label="Moneda de consulta" aria-busy={pending}>
        {currencies.map((code) => (
          <button key={code} type="button" aria-pressed={code === current} disabled={pending}
            onClick={() => {
              if (code !== current) {
                currency.mutate(code, {
                  onError: () => toast.error(`No pudimos cambiar la moneda. Se mantiene ${current}.`),
                });
              }
            }}>
            {code}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">{pending ? `Cambiando la moneda a ${currency.variables}…` : ''}</p>
    </div>
  );
}
