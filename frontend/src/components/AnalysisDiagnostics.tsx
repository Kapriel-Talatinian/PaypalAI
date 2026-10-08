import type { SolverResult } from '../types';
import './analysis-diagnostics.css';

export default function AnalysisDiagnostics({
  solver,
}: {
  solver: SolverResult | null | undefined;
}) {
  const details = solver?.diagnostic_details ?? [];
  const attention = details.filter((item) => item.severity !== 'info');
  const information = details.filter((item) => item.severity === 'info');
  const legacy = details.length ? [] : (solver?.diagnostics ?? []);
  if (!details.length && !legacy.length) return null;

  return (
    <section className="analysis-diagnostics" aria-label="Analysis diagnostics">
      {(attention.length > 0 || legacy.length > 0) && (
        <>
          <h3>Check before responding</h3>
          <ul>
            {attention.map((item, index) => (
              <li key={`${item.code}-${index}`} data-severity={item.severity}>
                <strong>{item.severity === 'error' ? 'Blocking issue' : 'Review needed'}</strong>
                <p>{item.message}</p>
                {item.suggestions.length > 0 && (
                  <small>
                    Possible vocabulary matches: {item.suggestions.join(', ')}. Check the source
                    before changing a fact.
                  </small>
                )}
              </li>
            ))}
            {legacy.map((message, index) => (
              <li key={index}>
                <p>{message}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {information.length > 0 && (
        <details>
          <summary>Analysis notes ({information.length})</summary>
          <ul>
            {information.map((item, index) => (
              <li key={`${item.code}-${index}`}>
                <p>{item.message}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
