import type { AnalysisStep } from '../types';
import './processing-trace.css';

const names: Record<AnalysisStep['component'], string> = {
  policy_retrieval: 'Retrieve policy clauses',
  extraction: 'Extract facts and rules',
  verification: 'Verify sources and citations',
  asp_reasoning: 'Calculate logical outcomes',
  governance: 'Check response authorization',
};

export default function ProcessingTrace({ steps }: { steps: AnalysisStep[] | undefined }) {
  if (!steps?.length) return null;
  return (
    <details className="processing-trace">
      <summary>Processing trace ({steps.length} steps)</summary>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            <strong>{names[step.component]}</strong>
            <span>
              {step.status} · {Math.round(step.duration_ms)} ms · Attempt {step.attempt + 1}
            </span>
            <small>
              {step.mode === 'probabilistic' ? 'Model-assisted' : 'Deterministic checks'} · Contract{' '}
              {step.contract_version}
            </small>
            {step.error_code && <p>{step.error_code}</p>}
            {step.diagnostics.map((diagnostic, detail) => (
              <p key={detail}>{diagnostic}</p>
            ))}
          </li>
        ))}
      </ol>
    </details>
  );
}
