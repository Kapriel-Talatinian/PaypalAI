import { useId, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  Network,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  Citation,
  Evidence,
  Fact,
  Literal,
  ProofNode,
  Rule,
  RunView,
  StableModel,
} from '../types';
import { ACTION_LABELS } from '../lib/format';
import './proof.css';

export interface ProofGraphProps {
  run: RunView | null;
}

type NodeState = 'evidence' | 'applied' | 'defeated' | 'inactive' | 'conclusion' | 'excluded';
interface DisplayNode {
  id: string;
  title: string;
  subtitle: string;
  eyebrow: string;
  state: NodeState;
  x: number;
  y: number;
  evidence?: Evidence;
  fact?: Fact;
  rule?: Rule;
  literal?: Literal;
  original?: ProofNode;
}
interface DisplayEdge {
  source: string;
  target: string;
  relation: string;
  state: NodeState;
}

const actionLabels: Record<string, string> = ACTION_LABELS;
const factLabels: Record<string, string> = {
  claim_nonreceipt: 'Buyer reports nonreceipt',
  delivery_verified: 'Delivery confirmed',
  tracking_invalid: 'Tracking is invalid',
  quality_complaint: 'Product quality disputed',
  seller_inspection: 'Seller inspection recorded',
};
const literalKey = (literal: Literal) => `${literal.negated ? '-' : ''}${literal.name}`;
const humanize = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
function literalLabel(literal: Literal) {
  const value = literal.name.startsWith('decision_')
    ? (actionLabels[literal.name.replace('decision_', '')] ??
      humanize(literal.name.replace('decision_', '')))
    : (factLabels[literal.name] ?? humanize(literal.name));
  if (literal.negated && !literal.name.startsWith('decision_'))
    return literal.name === 'delivery_verified'
      ? 'Delivery explicitly contradicted'
      : `Not: ${value.toLowerCase()}`;
  return literal.negated ? `Exclude: ${value.toLowerCase()}` : value;
}
const truncate = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1).trim()}…` : value;

function createGraph(run: RunView, model: StableModel | undefined) {
  const result = run.result;
  const knowledge = result?.knowledge_base;
  const proof = result?.solver?.proof;
  if (!knowledge || !proof)
    return { nodes: [] as DisplayNode[], edges: [] as DisplayEdge[], omitted: 0 };
  const originals = new Map(proof.nodes.map((node) => [node.id, node]));
  const applied = new Set(model?.applied_rules ?? []);
  const defeated = new Set(model?.defeated_rules ?? []);
  const stateOf = (rule: Rule): NodeState =>
    applied.has(rule.id) ? 'applied' : defeated.has(rule.id) ? 'defeated' : 'inactive';
  const depths = new Map<string, number>();
  const dependencyDepth = (rule: Rule, visiting = new Set<string>()): number => {
    if (visiting.has(rule.id) || visiting.size >= 6) return 0;
    if (depths.has(rule.id)) return depths.get(rule.id)!;
    const next = new Set([...visiting, rule.id]);
    const producers = knowledge.rules.filter(
      (candidate) =>
        candidate.id !== rule.id &&
        applied.has(candidate.id) &&
        candidate.kind !== 'defeater' &&
        rule.body.some((literal) => literalKey(literal) === literalKey(candidate.head)),
    );
    const depth = producers.length
      ? Math.max(...producers.map((producer) => dependencyDepth(producer, next) + 1))
      : 0;
    depths.set(rule.id, depth);
    return depth;
  };
  const ranked = [...knowledge.rules].sort((left, right) => {
    const rank = (rule: Rule) => (applied.has(rule.id) ? 0 : defeated.has(rule.id) ? 1 : 2);
    return (
      rank(left) - rank(right) ||
      dependencyDepth(left) - dependencyDepth(right) ||
      left.id.localeCompare(right.id)
    );
  });
  const rules = ranked.slice(0, 6);
  const relevantFacts = knowledge.facts.filter(
    (fact) =>
      !rules.length ||
      rules.some((rule) =>
        [...rule.body, ...rule.unless].some((literal) => literal.name === fact.literal.name),
      ),
  );
  const evidenceIds = new Set(relevantFacts.flatMap((fact) => fact.evidence_ids));
  const evidenceRank = (item: Evidence) => {
    const supported = relevantFacts.filter((fact) => fact.evidence_ids.includes(item.id));
    const index = rules.findIndex((rule) =>
      [...rule.body, ...rule.unless].some((literal) =>
        supported.some((fact) => literal.name === fact.literal.name),
      ),
    );
    return index < 0 ? rules.length : index;
  };
  const evidence = run.input_snapshot.evidence
    .filter((item) => evidenceIds.has(item.id))
    .sort(
      (left, right) => evidenceRank(left) - evidenceRank(right) || left.id.localeCompare(right.id),
    )
    .slice(0, 6);
  const nodes: DisplayNode[] = [];
  const height = Math.max(evidence.length, rules.length, 1) * 100;
  const center = (count: number, index: number) => 22 + (height - count * 100) / 2 + index * 100;
  evidence.forEach((item, index) => {
    const fact = relevantFacts.find((candidate) => candidate.evidence_ids.includes(item.id));
    nodes.push({
      id: `evidence:${item.id}`,
      x: 20,
      y: center(evidence.length, index),
      title: fact ? literalLabel(fact.literal) : humanize(item.kind),
      subtitle: item.source || item.id,
      eyebrow: item.verified ? 'VERIFIED SOURCE' : 'UNVERIFIED SOURCE',
      state: 'evidence',
      evidence: item,
      fact,
      original: originals.get(`evidence:${item.id}`),
    });
  });
  rules.forEach((rule, index) => {
    const clause = result?.retrieval.clauses.find(
      (item) => item.id === rule.citations[0]?.clause_id,
    );
    const state = stateOf(rule);
    nodes.push({
      id: `rule:${rule.id}`,
      x: 320,
      y: center(rules.length, index),
      title: clause?.title ?? humanize(rule.id),
      subtitle:
        rule.kind === 'defeater' ? 'Blocks the contrary conclusion' : literalLabel(rule.head),
      eyebrow:
        state === 'applied'
          ? 'APPLIED RULE'
          : state === 'defeated'
            ? 'DEFEATED RULE'
            : model
              ? 'INACTIVE RULE'
              : 'CANDIDATE RULE',
      state,
      rule,
      original: originals.get(`rule:${rule.id}`),
    });
  });
  const conclusionMap = new Map<string, Literal>();
  for (const literal of model?.literals ?? []) {
    if (literal.name.startsWith('decision_')) conclusionMap.set(literalKey(literal), literal);
  }
  for (const rule of rules) {
    if (rule.head.name.startsWith('decision_') && rule.kind !== 'defeater')
      conclusionMap.set(literalKey(rule.head), rule.head);
  }
  const present = new Set(model?.literals.map(literalKey) ?? []);
  const conclusions = [...conclusionMap.values()]
    .sort((left, right) => {
      const rank = (literal: Literal) =>
        present.has(literalKey(literal)) ? (literal.negated ? 1 : 0) : 2;
      return rank(left) - rank(right) || literalKey(left).localeCompare(literalKey(right));
    })
    .slice(0, 4);
  conclusions.forEach((literal, index) => {
    const established = present.has(literalKey(literal));
    nodes.push({
      id: `literal:${literalKey(literal)}`,
      x: 620,
      y: center(conclusions.length, index),
      title: literalLabel(literal),
      subtitle: established
        ? `Established in ${model?.id}`
        : model
          ? 'Absent from selected model'
          : 'No stable model available',
      eyebrow: established
        ? literal.negated
          ? 'EXPLICIT NEGATION'
          : 'DERIVED ACTION'
        : 'NOT DERIVED',
      state: established ? 'conclusion' : 'excluded',
      literal,
      original: originals.get(`literal:${literalKey(literal)}`),
    });
  });
  if (!conclusions.length) {
    nodes.push({
      id: model ? `model:${model.id}` : 'reasoning',
      x: 620,
      y: center(1, 0),
      title: model ? 'No action derived' : solverStatusLabel(result?.solver?.status),
      subtitle: model ? 'The model has no positive decision' : 'Human investigation required',
      eyebrow: model ? 'STABLE MODEL' : 'SOLVER RESULT',
      state: 'excluded',
      original: originals.get(model ? `model:${model.id}` : 'reasoning'),
    });
  }
  const edges: DisplayEdge[] = [];
  for (const item of evidence) {
    const facts = relevantFacts.filter((fact) => fact.evidence_ids.includes(item.id));
    for (const rule of rules) {
      for (const fact of facts) {
        const condition = rule.body.some(
          (literal) => literalKey(literal) === literalKey(fact.literal),
        );
        const exception = rule.unless.some(
          (literal) => literalKey(literal) === literalKey(fact.literal),
        );
        if (condition || exception)
          edges.push({
            source: `evidence:${item.id}`,
            target: `rule:${rule.id}`,
            relation: exception
              ? 'Establishes an exception'
              : `Supports premise: ${fact.literal.name}`,
            state: stateOf(rule),
          });
      }
    }
  }
  for (const rule of rules) {
    const head = `literal:${literalKey(rule.head)}`;
    if (rule.kind !== 'defeater' && nodes.some((node) => node.id === head)) {
      edges.push({
        source: `rule:${rule.id}`,
        target: head,
        relation: applied.has(rule.id)
          ? 'Derives conclusion'
          : defeated.has(rule.id)
            ? 'Defeated derivation'
            : 'Potential conclusion',
        state: stateOf(rule),
      });
    }
    if (rule.kind === 'defeater' && applied.has(rule.id)) {
      const contrary = `literal:${literalKey({ ...rule.head, negated: !rule.head.negated })}`;
      if (nodes.some((node) => node.id === contrary))
        edges.push({
          source: `rule:${rule.id}`,
          target: contrary,
          relation: 'Blocks contrary conclusion',
          state: 'defeated',
        });
    }
    for (const consumer of rules) {
      if (
        consumer.id !== rule.id &&
        applied.has(rule.id) &&
        consumer.body.some((literal) => literalKey(literal) === literalKey(rule.head)) &&
        rule.kind !== 'defeater'
      ) {
        edges.push({
          source: `rule:${rule.id}`,
          target: `rule:${consumer.id}`,
          relation: 'Supplies a derived premise',
          state: stateOf(consumer),
        });
      }
    }
  }
  const conflicts = new Set<string>();
  for (const edge of proof.edges.filter((item) => item.relation === 'contradicts')) {
    const sourceFact = knowledge.facts.find((fact) => `fact:${fact.id}` === edge.source);
    const targetFact = knowledge.facts.find((fact) => `fact:${fact.id}` === edge.target);
    for (const sourceId of sourceFact?.evidence_ids ?? []) {
      for (const targetId of targetFact?.evidence_ids ?? []) {
        const identity = [sourceId, targetId].sort().join(':');
        if (sourceId === targetId || conflicts.has(identity)) continue;
        const source = `evidence:${sourceId}`;
        const target = `evidence:${targetId}`;
        if (nodes.some((node) => node.id === source) && nodes.some((node) => node.id === target)) {
          conflicts.add(identity);
          edges.push({
            source,
            target,
            relation: 'Grounded facts explicitly contradict one another',
            state: 'defeated',
          });
        }
      }
    }
  }
  return {
    nodes,
    edges,
    omitted:
      Math.max(0, knowledge.rules.length - rules.length) +
      Math.max(0, evidenceIds.size - evidence.length),
    height: height + 44,
  };
}

function solverStatusLabel(status: string | undefined) {
  if (status === 'inconsistent') return 'No consistent stable model';
  if (status === 'timeout') return 'Solver time limit reached';
  if (status === 'truncated') return 'Enumeration incomplete';
  return 'No stable model available';
}

function SourceQuote({ citation, run }: { citation: Citation; run: RunView }) {
  const clause = run.result?.retrieval.clauses.find((item) => item.id === citation.clause_id);
  const isWeb =
    clause?.source_url.startsWith('https://') || clause?.source_url.startsWith('http://');
  return (
    <div className="proof-quote">
      <div className="proof-quote-heading">
        <BookOpen size={13} />
        <span>{clause?.title ?? citation.clause_id}</span>
      </div>
      <blockquote>{citation.quote}</blockquote>
      <div className="proof-quote-meta">
        <code>{citation.clause_id}</code>
        {clause && <span>v{clause.version}</span>}
      </div>
      {clause &&
        (isWeb ? (
          <a href={clause.source_url} target="_blank" rel="noreferrer">
            View policy source <ArrowUpRight size={12} />
          </a>
        ) : (
          <span className="proof-source-url">{clause.source_url}</span>
        ))}
    </div>
  );
}

function NodeInspector({
  node,
  run,
  model,
}: {
  node: DisplayNode;
  run: RunView;
  model: StableModel | undefined;
}) {
  const knowledge = run.result?.knowledge_base;
  const linkedFacts = node.evidence
    ? (knowledge?.facts.filter((fact) => fact.evidence_ids.includes(node.evidence!.id)) ?? [])
    : [];
  const producers = node.literal
    ? (knowledge?.rules.filter(
        (rule) =>
          literalKey(rule.head) === literalKey(node.literal!) &&
          model?.applied_rules.includes(rule.id),
      ) ?? [])
    : [];
  const citations = node.rule?.citations ?? producers.flatMap((rule) => rule.citations);
  const priorities = node.rule
    ? (knowledge?.priorities.filter(
        (priority) => priority.higher === node.rule?.id || priority.lower === node.rule?.id,
      ) ?? [])
    : [];
  return (
    <aside className="proof-inspector" aria-label="Selected proof source">
      <div className="proof-inspector-kicker">
        <Search size={14} /> SOURCE INSPECTOR
      </div>
      <h3>{node.title}</h3>
      <code className="proof-node-id">{node.original?.id ?? node.id}</code>
      {node.evidence && (
        <>
          <div className="proof-inspector-label">ORIGINAL EVIDENCE</div>
          <blockquote className="proof-evidence-content">{node.evidence.content}</blockquote>
          <dl className="proof-metadata">
            <div>
              <dt>Source</dt>
              <dd>{node.evidence.source}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{node.evidence.verified ? 'Verified' : 'Not verified'}</dd>
            </div>
            <div>
              <dt>Document type</dt>
              <dd>{humanize(node.evidence.kind)}</dd>
            </div>
          </dl>
          {linkedFacts.length > 0 && (
            <>
              <div className="proof-inspector-label">GROUNDED FACTS</div>
              <div className="proof-literal-list">
                {linkedFacts.map((fact) => (
                  <code key={fact.id}>{literalKey(fact.literal)}</code>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {node.rule && (
        <>
          <dl className="proof-metadata">
            <div>
              <dt>Rule type</dt>
              <dd>{humanize(node.rule.kind)}</dd>
            </div>
            <div>
              <dt>Model status</dt>
              <dd>{humanize(node.state)}</dd>
            </div>
          </dl>
          <div className="proof-inspector-label">LOGICAL CONDITIONS</div>
          <div className="proof-formula">
            {node.rule.body.length > 0
              ? node.rule.body.map(literalKey).join(' ∧ ')
              : 'Unconditional'}
            <span>→ {literalKey(node.rule.head)}</span>
            {node.rule.unless.length > 0 && (
              <small>Unless {node.rule.unless.map(literalKey).join(' or ')}</small>
            )}
          </div>
          {priorities.map((priority) => (
            <div className="proof-priority" key={`${priority.higher}:${priority.lower}`}>
              <GitBranch size={13} />
              <span>
                <code>{priority.higher}</code> overrides <code>{priority.lower}</code>
              </span>
              {priority.citations.map((citation, index) => (
                <SourceQuote key={`${citation.clause_id}:${index}`} citation={citation} run={run} />
              ))}
            </div>
          ))}
        </>
      )}
      {node.literal && (
        <>
          <div className="proof-inspector-label">SOLVER LITERAL</div>
          <div className="proof-literal-list">
            <code>{literalKey(node.literal)}</code>
          </div>
          <p className="proof-inspector-description">
            {node.state === 'conclusion'
              ? node.literal.negated
                ? 'The selected stable model contains this explicit negative conclusion.'
                : 'The selected stable model contains this action. Governance determines whether it can be executed.'
              : 'This conclusion is absent from the selected stable model.'}
          </p>
        </>
      )}
      {node.original?.kind === 'reasoning' && (
        <>
          <div className="proof-inspector-label">SOLVER DIAGNOSTICS</div>
          <p className="proof-inspector-description">
            {run.result?.solver?.diagnostics.join(' ') ||
              'No stable model was returned. No solver action can be inferred from this result.'}
          </p>
          <div className="proof-inspector-label">PROGRAM SHA-256</div>
          <code className="proof-node-id">{run.result?.solver?.program_sha256}</code>
        </>
      )}
      {node.original?.kind === 'stable_model' && (
        <>
          <div className="proof-inspector-label">MODEL LITERALS</div>
          <div className="proof-literal-list">
            {model?.literals.map((literal) => (
              <code key={literalKey(literal)}>{literalKey(literal)}</code>
            ))}
          </div>
          <p className="proof-inspector-description">
            A stable model was returned, but it contains no positive action conclusion.
          </p>
        </>
      )}
      {citations.length > 0 && (
        <>
          <div className="proof-inspector-label">EXACT POLICY CITATIONS</div>
          {citations.map((citation, index) => (
            <SourceQuote citation={citation} run={run} key={`${citation.clause_id}:${index}`} />
          ))}
        </>
      )}
    </aside>
  );
}

export default function ProofGraph({ run }: ProofGraphProps) {
  const [modelId, setModelId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [browseSources, setBrowseSources] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');
  const markerId = useId().replaceAll(':', '');
  const solver = run?.result?.solver;
  const model = solver?.models.find((item) => item.id === modelId) ?? solver?.models[0];
  const graph = useMemo(
    () => (run ? createGraph(run, model) : { nodes: [], edges: [], omitted: 0, height: 300 }),
    [run, model],
  );
  const selected =
    graph.nodes.find((node) => node.id === nodeId) ??
    graph.nodes.find((node) => node.state === 'conclusion') ??
    graph.nodes[0];
  const selectedSources =
    run?.input_snapshot.evidence.filter((item) =>
      `${item.id} ${item.source} ${item.content}`.toLowerCase().includes(sourceQuery.toLowerCase()),
    ) ?? [];
  const clauses =
    run?.result?.retrieval.clauses.filter((item) =>
      `${item.id} ${item.title} ${item.text}`.toLowerCase().includes(sourceQuery.toLowerCase()),
    ) ?? [];
  if (!run?.result || !solver)
    return (
      <section className="proof-panel proof-empty">
        <Network size={28} strokeWidth={1.3} />
        <h3>No reasoning graph yet</h3>
        <p>Run an analysis to inspect grounded evidence, policy rules, and solver conclusions.</p>
      </section>
    );
  return (
    <section className="proof-panel" aria-label="Reasoning graph">
      <div className="proof-header">
        <div>
          <div className="proof-heading">
            <Network size={17} />
            <h2>Reasoning graph</h2>
          </div>
          <p>Follow each conclusion back to its evidence and exact policy source.</p>
        </div>
        <div className="proof-header-actions">
          {solver.models.length > 1 ? (
            <label className="proof-model-select">
              <GitBranch size={14} />
              <span className="proof-sr-only">Stable model</span>
              <select
                value={model?.id ?? ''}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setNodeId('');
                }}
              >
                {solver.models.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    Model {String(index + 1).padStart(2, '0')} /{' '}
                    {String(solver.models.length).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
          ) : (
            <span className="proof-model-label">
              <GitBranch size={13} />
              {model ? 'One stable model' : 'No stable model'}
            </span>
          )}
          <button
            type="button"
            className="proof-source-button"
            onClick={() => setBrowseSources(!browseSources)}
            aria-expanded={browseSources}
          >
            <BookOpen size={14} />
            {browseSources ? 'Close sources' : 'Browse sources'}
          </button>
        </div>
      </div>
      <div className="proof-legend">
        <span>
          <i className="proof-dot proof-dot-applied" />
          Applied rule
        </span>
        <span>
          <i className="proof-dot proof-dot-defeated" />
          Defeated rule
        </span>
        <span>
          <i className="proof-dot proof-dot-conclusion" />
          Derived action
        </span>
        <span className="proof-legend-note">Select a node to inspect its source</span>
      </div>
      {browseSources && (
        <div className="proof-source-browser">
          <label className="proof-source-search">
            <Search size={15} />
            <span className="proof-sr-only">Search evidence and policy sources</span>
            <input
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
              placeholder="Search every evidence and policy source…"
            />
          </label>
          <div className="proof-source-results">
            {selectedSources.map((evidence) => (
              <details key={evidence.id}>
                <summary>
                  <FileText size={14} />
                  <span>{evidence.id}</span>
                  <small>{evidence.verified ? 'Verified evidence' : 'Evidence'}</small>
                </summary>
                <blockquote>{evidence.content}</blockquote>
                <p>{evidence.source}</p>
              </details>
            ))}
            {clauses.map((clause) => (
              <details key={clause.id}>
                <summary>
                  <BookOpen size={14} />
                  <span>{clause.title}</span>
                  <small>{clause.id}</small>
                </summary>
                <blockquote>{clause.text}</blockquote>
                <p>
                  Version {clause.version} · {clause.source_url}
                </p>
                <code>{clause.sha256}</code>
              </details>
            ))}
            {selectedSources.length + clauses.length === 0 && (
              <p className="proof-no-results">No sources match this search.</p>
            )}
          </div>
        </div>
      )}
      <div className="proof-content">
        <div className="proof-graph-area">
          <div className="proof-column-headings">
            <span>
              01 <strong>Evidence</strong>
            </span>
            <span>
              02 <strong>Policy rules</strong>
            </span>
            <span>
              03 <strong>Conclusion</strong>
            </span>
          </div>
          {graph.nodes.length > 0 ? (
            <div className="proof-canvas">
              <svg
                viewBox={`0 0 864 ${graph.height ?? 344}`}
                role="group"
                aria-label={`Proof graph for ${model?.id ?? 'an analysis without a stable model'}`}
              >
                <defs>
                  {(['applied', 'defeated', 'inactive'] as const).map((state) => (
                    <marker
                      key={state}
                      id={`${markerId}-${state}`}
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" className={`proof-arrow-${state}`} />
                    </marker>
                  ))}
                </defs>
                {graph.edges.map((edge, index) => {
                  const source = graph.nodes.find((node) => node.id === edge.source);
                  const target = graph.nodes.find((node) => node.id === edge.target);
                  if (!source || !target) return null;
                  const isRuleChain = source.x === target.x;
                  const startX = source.x + 224;
                  const startY = source.y + 38;
                  const endX = isRuleChain ? target.x + 224 : target.x;
                  const endY = target.y + 38;
                  const path = isRuleChain
                    ? `M ${startX} ${startY} C ${startX + 32} ${startY} ${endX + 32} ${endY} ${endX} ${endY}`
                    : `M ${startX} ${startY} C ${startX + 40} ${startY} ${endX - 40} ${endY} ${endX} ${endY}`;
                  const state =
                    edge.state === 'applied'
                      ? 'applied'
                      : edge.state === 'defeated'
                        ? 'defeated'
                        : 'inactive';
                  const highlighted = selected?.id === edge.source || selected?.id === edge.target;
                  return (
                    <path
                      key={`${edge.source}:${edge.target}:${index}`}
                      d={path}
                      className={`proof-edge proof-edge-${state}${highlighted ? ' proof-edge-highlighted' : ''}`}
                      markerEnd={`url(#${markerId}-${state})`}
                    >
                      <title>{edge.relation}</title>
                    </path>
                  );
                })}
                {graph.nodes.map((node) => (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    className={`proof-node proof-node-${node.state}${selected?.id === node.id ? ' proof-node-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.title}. ${node.eyebrow}. Inspect source.`}
                    aria-pressed={selected?.id === node.id}
                    onClick={() => setNodeId(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setNodeId(node.id);
                      }
                    }}
                  >
                    <rect width="224" height="76" rx="5" />
                    <text x="15" y="20" className="proof-node-eyebrow">
                      {node.eyebrow}
                    </text>
                    <text x="15" y="42" className="proof-node-title">
                      {truncate(node.title, 29)}
                    </text>
                    <text x="15" y="60" className="proof-node-subtitle">
                      {truncate(node.subtitle, 33)}
                    </text>
                    {node.state === 'applied' && <Check x="198" y="9" size={13} />}
                    {node.state === 'defeated' && <X x="198" y="9" size={13} />}
                    {node.state === 'evidence' && node.evidence?.verified && (
                      <ShieldCheck x="197" y="9" size={14} />
                    )}
                    <title>
                      {node.title} · {node.subtitle}
                    </title>
                  </g>
                ))}
              </svg>
            </div>
          ) : (
            <div className="proof-empty-inline">
              No grounded proof nodes are available for this analysis.
            </div>
          )}
          <div className="proof-canvas-footer">
            <span>
              {graph.nodes.length} displayed nodes · {solver.proof.nodes.length} recorded proof
              nodes
            </span>
            <span>
              {graph.omitted > 0
                ? 'Focused view · all sources available above'
                : 'Evidence → grounded rules → solver conclusions'}
            </span>
          </div>
        </div>
        {selected && <NodeInspector node={selected} run={run} model={model} />}
      </div>
      {!solver.enumeration_complete && (
        <div className="proof-incomplete">
          Model enumeration is incomplete. This view represents the returned models; it does not
          establish a unique conclusion.
        </div>
      )}
    </section>
  );
}
