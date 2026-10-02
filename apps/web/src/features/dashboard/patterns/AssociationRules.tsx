import type { AnalysisResults } from '@reqcanvas/shared';

type Rules = NonNullable<AnalysisResults['association']>;
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });

/**
 * Reglas de asociación (US4-2): patrones entre etiquetas, tipos, prioridades y actividades,
 * cada uno explicado en una frase, con su soporte y su confianza.
 */
export function AssociationRules({ rules }: { rules: Rules }) {
  if (rules.length === 0) {
    return <p>No se encontraron patrones claros entre etiquetas, tipos y actividades.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <caption className="mb-2 text-left text-gray-600">
        Soporte: qué parte de los requisitos cumple la regla. Confianza: de los que cumplen la
        condición, cuántos cumplen la consecuencia.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="border-b py-1 pr-3 font-medium">
            Patrón
          </th>
          <th scope="col" className="border-b py-1 pr-3 font-medium">
            Soporte
          </th>
          <th scope="col" className="border-b py-1 pr-3 font-medium">
            Confianza
          </th>
          <th scope="col" className="border-b py-1 font-medium">
            Veces más que lo esperado
          </th>
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={`${rule.antecedent.join('+')}→${rule.consequent.join('+')}`}>
            <th scope="row" className="py-1 pr-3 font-normal">
              {rule.sentence}
            </th>
            <td className="py-1 pr-3 tabular-nums">{percent.format(rule.support)}</td>
            <td className="py-1 pr-3 tabular-nums">{percent.format(rule.confidence)}</td>
            <td className="py-1 tabular-nums">{decimal.format(rule.lift)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
