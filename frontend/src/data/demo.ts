import type {
  Action,
  AnalysisResult,
  AuditEvent,
  CaseInput,
  Evidence,
  Metrics,
  PolicyDocument,
  WorkspaceCase,
  WorkspacePolicy,
} from '../types';

// Recorded with the bundled Python DemoExtractor and clingo 5.8.0.
// Replayed offline; no API, PayPal, or language model is contacted.
const TEMPLATES: Record<string, AnalysisResult> = {
  'claim_nonreceipt|delivery_verified': {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'buyer_nonreceipt',
          section_path: ['Nonreceipt demonstration', 'Buyer nonreceipt recommendation'],
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9ce64b341df5d7a544255071d3cd124a2609e8c272c0b8510e7978a3b8d10dbc',
        },
        {
          id: 'seller_delivery',
          section_path: ['Nonreceipt demonstration', 'Verified delivery exception'],
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '902d571303408fda88adad2b0ea0d5ea3f7b33bd1204064f2d1ed24ee3cf68ed',
        },
        {
          id: 'invalid_tracking',
          section_path: ['Nonreceipt demonstration', 'Invalid tracking defeater'],
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '38e8e38ce2d89f2cfbc993dfdfb34e2a58075620fb046d8cf4ad7fc8c686161e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'claim_nonreceipt', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
        {
          id: 'fact_2',
          literal: { name: 'delivery_verified', negated: false },
          evidence_ids: ['fixture_1'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_nonreceipt',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'claim_nonreceipt', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          ],
        },
        {
          id: 'seller_delivery',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'delivery_verified', negated: false }],
          unless: [{ name: 'tracking_invalid', negated: false }],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          ],
        },
        {
          id: 'invalid_tracking',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'tracking_invalid', negated: false }],
          unless: [],
          kind: 'defeater',
          citations: [
            {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [
        {
          higher: 'seller_delivery',
          lower: 'buyer_nonreceipt',
          citations: [
            {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          ],
        },
        {
          higher: 'invalid_tracking',
          lower: 'seller_delivery',
          citations: [
            {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          ],
        },
      ],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_09d47d5c14fc8a41e592b6cf',
          literals: [
            { name: 'decision_accept_claim', negated: true },
            { name: 'claim_nonreceipt', negated: false },
            { name: 'decision_provide_evidence', negated: false },
            { name: 'delivery_verified', negated: false },
          ],
          applied_rules: ['contest_action', 'seller_delivery'],
          defeated_rules: ['buyer_nonreceipt'],
          decisions: ['provide_evidence'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: claim_nonreceipt\nopposite(0,1).\n% literal 1: -claim_nonreceipt\nopposite(1,0).\n% literal 2: decision_accept_claim\nopposite(2,3).\n% literal 3: -decision_accept_claim\nopposite(3,2).\n% literal 4: decision_provide_evidence\nopposite(4,5).\n% literal 5: -decision_provide_evidence\nopposite(5,4).\n% literal 6: delivery_verified\nopposite(6,7).\n% literal 7: -delivery_verified\nopposite(7,6).\n% literal 8: tracking_invalid\nopposite(8,9).\n% literal 9: -tracking_invalid\nopposite(9,8).\nfact(0,0).\nfact(1,6).\n% rule 0: buyer_nonreceipt\nkind(0,defeasible).\nhead(0,2).\napplicable(0) :- holds(0).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,4).\napplicable(1) :- holds(3).\n% rule 2: invalid_tracking\nkind(2,defeater).\nhead(2,2).\napplicable(2) :- holds(8).\n% rule 3: seller_delivery\nkind(3,defeasible).\nhead(3,3).\napplicable(3) :- holds(6), not holds(8).\nhigher(2,3).\nhigher(3,0).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: '73891216db0e859ea6515727ef8c71ca6315ce335a07e6b87c66df5fc733ac84',
      skeptical: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'claim_nonreceipt', negated: false },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'delivery_verified', negated: false },
      ],
      credulous: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'claim_nonreceipt', negated: false },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'delivery_verified', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_09d47d5c14fc8a41e592b6cf:contest_action',
            kind: 'application',
            label: 'contest_action',
            data: {
              model_id: 'm_09d47d5c14fc8a41e592b6cf',
              rule_id: 'contest_action',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'application:m_09d47d5c14fc8a41e592b6cf:seller_delivery',
            kind: 'application',
            label: 'seller_delivery',
            data: {
              model_id: 'm_09d47d5c14fc8a41e592b6cf',
              rule_id: 'seller_delivery',
              derives_head: true,
              absent_exceptions: ['tracking_invalid'],
            },
          },
          {
            id: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            kind: 'citation',
            label: 'invalid_tracking',
            data: {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          },
          {
            id: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            kind: 'citation',
            label: 'delivery_priority',
            data: {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          },
          {
            id: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            kind: 'citation',
            label: 'invalid_priority',
            data: {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          },
          {
            id: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            kind: 'citation',
            label: 'seller_delivery',
            data: {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          },
          {
            id: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            kind: 'citation',
            label: 'buyer_nonreceipt',
            data: {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'defeat:m_09d47d5c14fc8a41e592b6cf:buyer_nonreceipt',
            kind: 'defeat',
            label: 'buyer_nonreceipt',
            data: { model_id: 'm_09d47d5c14fc8a41e592b6cf', rule_id: 'buyer_nonreceipt' },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'evidence:fixture_1',
            kind: 'evidence',
            label: 'fixture_1',
            data: { evidence_id: 'fixture_1' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'fact:fact_2',
            kind: 'fact',
            label: 'fact_2',
            data: {
              id: 'fact_2',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-claim_nonreceipt',
            kind: 'literal',
            label: '-claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: true },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-delivery_verified',
            kind: 'literal',
            label: '-delivery_verified',
            data: { name: 'delivery_verified', negated: true },
          },
          {
            id: 'literal:-tracking_invalid',
            kind: 'literal',
            label: '-tracking_invalid',
            data: { name: 'tracking_invalid', negated: true },
          },
          {
            id: 'literal:claim_nonreceipt',
            kind: 'literal',
            label: 'claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: false },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:delivery_verified',
            kind: 'literal',
            label: 'delivery_verified',
            data: { name: 'delivery_verified', negated: false },
          },
          {
            id: 'literal:tracking_invalid',
            kind: 'literal',
            label: 'tracking_invalid',
            data: { name: 'tracking_invalid', negated: false },
          },
          {
            id: 'model:m_09d47d5c14fc8a41e592b6cf',
            kind: 'stable_model',
            label: 'm_09d47d5c14fc8a41e592b6cf',
            data: {
              id: 'm_09d47d5c14fc8a41e592b6cf',
              literals: [
                { name: 'decision_accept_claim', negated: true },
                { name: 'claim_nonreceipt', negated: false },
                { name: 'decision_provide_evidence', negated: false },
                { name: 'delivery_verified', negated: false },
              ],
              applied_rules: ['contest_action', 'seller_delivery'],
              defeated_rules: ['buyer_nonreceipt'],
              decisions: ['provide_evidence'],
            },
          },
          {
            id: 'priority:0',
            kind: 'priority',
            label: 'invalid_tracking > seller_delivery',
            data: {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          },
          {
            id: 'priority:1',
            kind: 'priority',
            label: 'seller_delivery > buyer_nonreceipt',
            data: {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: '73891216db0e859ea6515727ef8c71ca6315ce335a07e6b87c66df5fc733ac84',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_nonreceipt',
            kind: 'rule',
            label: 'buyer_nonreceipt',
            data: {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:invalid_tracking',
            kind: 'rule',
            label: 'invalid_tracking',
            data: {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_delivery',
            kind: 'rule',
            label: 'seller_delivery',
            data: {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_09d47d5c14fc8a41e592b6cf:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'derives',
          },
          {
            source: 'application:m_09d47d5c14fc8a41e592b6cf:seller_delivery',
            target: 'defeat:m_09d47d5c14fc8a41e592b6cf:buyer_nonreceipt',
            relation: 'opposing_rule',
          },
          {
            source: 'application:m_09d47d5c14fc8a41e592b6cf:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            target: 'rule:invalid_tracking',
            relation: 'grounds',
          },
          {
            source: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            target: 'priority:1',
            relation: 'grounds',
          },
          {
            source: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            target: 'priority:0',
            relation: 'grounds',
          },
          {
            source: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            target: 'rule:seller_delivery',
            relation: 'grounds',
          },
          {
            source: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            target: 'rule:buyer_nonreceipt',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          {
            source: 'defeat:m_09d47d5c14fc8a41e592b6cf:buyer_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'defeats',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'evidence:fixture_1', target: 'fact:fact_2', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:claim_nonreceipt', relation: 'asserts' },
          { source: 'fact:fact_2', target: 'literal:delivery_verified', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'application:m_09d47d5c14fc8a41e592b6cf:contest_action',
            relation: 'supports',
          },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'premise',
          },
          {
            source: 'literal:delivery_verified',
            target: 'application:m_09d47d5c14fc8a41e592b6cf:seller_delivery',
            relation: 'supports',
          },
          {
            source: 'literal:delivery_verified',
            target: 'rule:seller_delivery',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:invalid_tracking',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:seller_delivery',
            relation: 'exception',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'application:m_09d47d5c14fc8a41e592b6cf:contest_action',
            relation: 'includes',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'application:m_09d47d5c14fc8a41e592b6cf:seller_delivery',
            relation: 'includes',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'defeat:m_09d47d5c14fc8a41e592b6cf:buyer_nonreceipt',
            relation: 'includes',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'literal:-decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'literal:claim_nonreceipt',
            relation: 'contains',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'literal:decision_provide_evidence',
            relation: 'contains',
          },
          {
            source: 'model:m_09d47d5c14fc8a41e592b6cf',
            target: 'literal:delivery_verified',
            relation: 'contains',
          },
          { source: 'priority:0', target: 'rule:invalid_tracking', relation: 'higher' },
          { source: 'priority:0', target: 'rule:seller_delivery', relation: 'lower' },
          { source: 'priority:1', target: 'rule:buyer_nonreceipt', relation: 'lower' },
          { source: 'priority:1', target: 'rule:seller_delivery', relation: 'higher' },
          {
            source: 'reasoning',
            target: 'model:m_09d47d5c14fc8a41e592b6cf',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'application:m_09d47d5c14fc8a41e592b6cf:contest_action',
            relation: 'instantiates',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'rule:seller_delivery',
            relation: 'overrides',
          },
          {
            source: 'rule:seller_delivery',
            target: 'application:m_09d47d5c14fc8a41e592b6cf:seller_delivery',
            relation: 'instantiates',
          },
          {
            source: 'rule:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:seller_delivery',
            target: 'rule:buyer_nonreceipt',
            relation: 'overrides',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: 'provide_evidence',
      confidence: 1.0,
      requires_human: true,
      reasons: [
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 1.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
            {
              id: 'fact_2',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: '73891216db0e859ea6515727ef8c71ca6315ce335a07e6b87c66df5fc733ac84',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  'claim_nonreceipt|delivery_verified|tracking_invalid': {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'buyer_nonreceipt',
          section_path: ['Nonreceipt demonstration', 'Buyer nonreceipt recommendation'],
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9ce64b341df5d7a544255071d3cd124a2609e8c272c0b8510e7978a3b8d10dbc',
        },
        {
          id: 'seller_delivery',
          section_path: ['Nonreceipt demonstration', 'Verified delivery exception'],
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '902d571303408fda88adad2b0ea0d5ea3f7b33bd1204064f2d1ed24ee3cf68ed',
        },
        {
          id: 'invalid_tracking',
          section_path: ['Nonreceipt demonstration', 'Invalid tracking defeater'],
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '38e8e38ce2d89f2cfbc993dfdfb34e2a58075620fb046d8cf4ad7fc8c686161e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'claim_nonreceipt', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
        {
          id: 'fact_2',
          literal: { name: 'delivery_verified', negated: false },
          evidence_ids: ['fixture_1'],
          confidence: 1.0,
        },
        {
          id: 'fact_3',
          literal: { name: 'tracking_invalid', negated: false },
          evidence_ids: ['fixture_2'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_nonreceipt',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'claim_nonreceipt', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          ],
        },
        {
          id: 'seller_delivery',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'delivery_verified', negated: false }],
          unless: [{ name: 'tracking_invalid', negated: false }],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          ],
        },
        {
          id: 'invalid_tracking',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'tracking_invalid', negated: false }],
          unless: [],
          kind: 'defeater',
          citations: [
            {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [
        {
          higher: 'seller_delivery',
          lower: 'buyer_nonreceipt',
          citations: [
            {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          ],
        },
        {
          higher: 'invalid_tracking',
          lower: 'seller_delivery',
          citations: [
            {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          ],
        },
      ],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_7bfd98d9f06ed492c151d32d',
          literals: [
            { name: 'claim_nonreceipt', negated: false },
            { name: 'decision_accept_claim', negated: false },
            { name: 'delivery_verified', negated: false },
            { name: 'tracking_invalid', negated: false },
          ],
          applied_rules: ['buyer_nonreceipt', 'invalid_tracking'],
          defeated_rules: [],
          decisions: ['accept_claim'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: claim_nonreceipt\nopposite(0,1).\n% literal 1: -claim_nonreceipt\nopposite(1,0).\n% literal 2: decision_accept_claim\nopposite(2,3).\n% literal 3: -decision_accept_claim\nopposite(3,2).\n% literal 4: decision_provide_evidence\nopposite(4,5).\n% literal 5: -decision_provide_evidence\nopposite(5,4).\n% literal 6: delivery_verified\nopposite(6,7).\n% literal 7: -delivery_verified\nopposite(7,6).\n% literal 8: tracking_invalid\nopposite(8,9).\n% literal 9: -tracking_invalid\nopposite(9,8).\nfact(0,0).\nfact(1,6).\nfact(2,8).\n% rule 0: buyer_nonreceipt\nkind(0,defeasible).\nhead(0,2).\napplicable(0) :- holds(0).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,4).\napplicable(1) :- holds(3).\n% rule 2: invalid_tracking\nkind(2,defeater).\nhead(2,2).\napplicable(2) :- holds(8).\n% rule 3: seller_delivery\nkind(3,defeasible).\nhead(3,3).\napplicable(3) :- holds(6), not holds(8).\nhigher(2,3).\nhigher(3,0).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: '1bd7e21560b81966ba266cbbfa70ec4a0c69dd1c12863bf6debfa86e9800314a',
      skeptical: [
        { name: 'claim_nonreceipt', negated: false },
        { name: 'decision_accept_claim', negated: false },
        { name: 'delivery_verified', negated: false },
        { name: 'tracking_invalid', negated: false },
      ],
      credulous: [
        { name: 'claim_nonreceipt', negated: false },
        { name: 'decision_accept_claim', negated: false },
        { name: 'delivery_verified', negated: false },
        { name: 'tracking_invalid', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_7bfd98d9f06ed492c151d32d:buyer_nonreceipt',
            kind: 'application',
            label: 'buyer_nonreceipt',
            data: {
              model_id: 'm_7bfd98d9f06ed492c151d32d',
              rule_id: 'buyer_nonreceipt',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'application:m_7bfd98d9f06ed492c151d32d:invalid_tracking',
            kind: 'application',
            label: 'invalid_tracking',
            data: {
              model_id: 'm_7bfd98d9f06ed492c151d32d',
              rule_id: 'invalid_tracking',
              derives_head: false,
              absent_exceptions: [],
            },
          },
          {
            id: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            kind: 'citation',
            label: 'invalid_tracking',
            data: {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          },
          {
            id: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            kind: 'citation',
            label: 'delivery_priority',
            data: {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          },
          {
            id: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            kind: 'citation',
            label: 'invalid_priority',
            data: {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          },
          {
            id: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            kind: 'citation',
            label: 'seller_delivery',
            data: {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          },
          {
            id: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            kind: 'citation',
            label: 'buyer_nonreceipt',
            data: {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'evidence:fixture_1',
            kind: 'evidence',
            label: 'fixture_1',
            data: { evidence_id: 'fixture_1' },
          },
          {
            id: 'evidence:fixture_2',
            kind: 'evidence',
            label: 'fixture_2',
            data: { evidence_id: 'fixture_2' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'fact:fact_2',
            kind: 'fact',
            label: 'fact_2',
            data: {
              id: 'fact_2',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
          },
          {
            id: 'fact:fact_3',
            kind: 'fact',
            label: 'fact_3',
            data: {
              id: 'fact_3',
              literal: { name: 'tracking_invalid', negated: false },
              evidence_ids: ['fixture_2'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-claim_nonreceipt',
            kind: 'literal',
            label: '-claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: true },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-delivery_verified',
            kind: 'literal',
            label: '-delivery_verified',
            data: { name: 'delivery_verified', negated: true },
          },
          {
            id: 'literal:-tracking_invalid',
            kind: 'literal',
            label: '-tracking_invalid',
            data: { name: 'tracking_invalid', negated: true },
          },
          {
            id: 'literal:claim_nonreceipt',
            kind: 'literal',
            label: 'claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: false },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:delivery_verified',
            kind: 'literal',
            label: 'delivery_verified',
            data: { name: 'delivery_verified', negated: false },
          },
          {
            id: 'literal:tracking_invalid',
            kind: 'literal',
            label: 'tracking_invalid',
            data: { name: 'tracking_invalid', negated: false },
          },
          {
            id: 'model:m_7bfd98d9f06ed492c151d32d',
            kind: 'stable_model',
            label: 'm_7bfd98d9f06ed492c151d32d',
            data: {
              id: 'm_7bfd98d9f06ed492c151d32d',
              literals: [
                { name: 'claim_nonreceipt', negated: false },
                { name: 'decision_accept_claim', negated: false },
                { name: 'delivery_verified', negated: false },
                { name: 'tracking_invalid', negated: false },
              ],
              applied_rules: ['buyer_nonreceipt', 'invalid_tracking'],
              defeated_rules: [],
              decisions: ['accept_claim'],
            },
          },
          {
            id: 'priority:0',
            kind: 'priority',
            label: 'invalid_tracking > seller_delivery',
            data: {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          },
          {
            id: 'priority:1',
            kind: 'priority',
            label: 'seller_delivery > buyer_nonreceipt',
            data: {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: '1bd7e21560b81966ba266cbbfa70ec4a0c69dd1c12863bf6debfa86e9800314a',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_nonreceipt',
            kind: 'rule',
            label: 'buyer_nonreceipt',
            data: {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:invalid_tracking',
            kind: 'rule',
            label: 'invalid_tracking',
            data: {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_delivery',
            kind: 'rule',
            label: 'seller_delivery',
            data: {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_7bfd98d9f06ed492c151d32d:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'application:m_7bfd98d9f06ed492c151d32d:invalid_tracking',
            target: 'literal:-decision_accept_claim',
            relation: 'blocks',
          },
          {
            source: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            target: 'rule:invalid_tracking',
            relation: 'grounds',
          },
          {
            source: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            target: 'priority:1',
            relation: 'grounds',
          },
          {
            source: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            target: 'priority:0',
            relation: 'grounds',
          },
          {
            source: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            target: 'rule:seller_delivery',
            relation: 'grounds',
          },
          {
            source: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            target: 'rule:buyer_nonreceipt',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'evidence:fixture_1', target: 'fact:fact_2', relation: 'supports' },
          { source: 'evidence:fixture_2', target: 'fact:fact_3', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:claim_nonreceipt', relation: 'asserts' },
          { source: 'fact:fact_2', target: 'literal:delivery_verified', relation: 'asserts' },
          { source: 'fact:fact_3', target: 'literal:tracking_invalid', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'application:m_7bfd98d9f06ed492c151d32d:buyer_nonreceipt',
            relation: 'supports',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'premise',
          },
          {
            source: 'literal:delivery_verified',
            target: 'rule:seller_delivery',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'application:m_7bfd98d9f06ed492c151d32d:invalid_tracking',
            relation: 'supports',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:invalid_tracking',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:seller_delivery',
            relation: 'exception',
          },
          {
            source: 'model:m_7bfd98d9f06ed492c151d32d',
            target: 'application:m_7bfd98d9f06ed492c151d32d:buyer_nonreceipt',
            relation: 'includes',
          },
          {
            source: 'model:m_7bfd98d9f06ed492c151d32d',
            target: 'application:m_7bfd98d9f06ed492c151d32d:invalid_tracking',
            relation: 'includes',
          },
          {
            source: 'model:m_7bfd98d9f06ed492c151d32d',
            target: 'literal:claim_nonreceipt',
            relation: 'contains',
          },
          {
            source: 'model:m_7bfd98d9f06ed492c151d32d',
            target: 'literal:decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_7bfd98d9f06ed492c151d32d',
            target: 'literal:delivery_verified',
            relation: 'contains',
          },
          {
            source: 'model:m_7bfd98d9f06ed492c151d32d',
            target: 'literal:tracking_invalid',
            relation: 'contains',
          },
          { source: 'priority:0', target: 'rule:invalid_tracking', relation: 'higher' },
          { source: 'priority:0', target: 'rule:seller_delivery', relation: 'lower' },
          { source: 'priority:1', target: 'rule:buyer_nonreceipt', relation: 'lower' },
          { source: 'priority:1', target: 'rule:seller_delivery', relation: 'higher' },
          {
            source: 'reasoning',
            target: 'model:m_7bfd98d9f06ed492c151d32d',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'application:m_7bfd98d9f06ed492c151d32d:buyer_nonreceipt',
            relation: 'instantiates',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'application:m_7bfd98d9f06ed492c151d32d:invalid_tracking',
            relation: 'instantiates',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'rule:seller_delivery',
            relation: 'overrides',
          },
          {
            source: 'rule:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:seller_delivery',
            target: 'rule:buyer_nonreceipt',
            relation: 'overrides',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: 'accept_claim',
      confidence: 1.0,
      requires_human: true,
      reasons: [
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 1.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
            {
              id: 'fact_2',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
            {
              id: 'fact_3',
              literal: { name: 'tracking_invalid', negated: false },
              evidence_ids: ['fixture_2'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: '1bd7e21560b81966ba266cbbfa70ec4a0c69dd1c12863bf6debfa86e9800314a',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  claim_nonreceipt: {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'buyer_nonreceipt',
          section_path: ['Nonreceipt demonstration', 'Buyer nonreceipt recommendation'],
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9ce64b341df5d7a544255071d3cd124a2609e8c272c0b8510e7978a3b8d10dbc',
        },
        {
          id: 'seller_delivery',
          section_path: ['Nonreceipt demonstration', 'Verified delivery exception'],
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '902d571303408fda88adad2b0ea0d5ea3f7b33bd1204064f2d1ed24ee3cf68ed',
        },
        {
          id: 'invalid_tracking',
          section_path: ['Nonreceipt demonstration', 'Invalid tracking defeater'],
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '38e8e38ce2d89f2cfbc993dfdfb34e2a58075620fb046d8cf4ad7fc8c686161e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'claim_nonreceipt', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_nonreceipt',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'claim_nonreceipt', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          ],
        },
        {
          id: 'seller_delivery',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'delivery_verified', negated: false }],
          unless: [{ name: 'tracking_invalid', negated: false }],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          ],
        },
        {
          id: 'invalid_tracking',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'tracking_invalid', negated: false }],
          unless: [],
          kind: 'defeater',
          citations: [
            {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [
        {
          higher: 'seller_delivery',
          lower: 'buyer_nonreceipt',
          citations: [
            {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          ],
        },
        {
          higher: 'invalid_tracking',
          lower: 'seller_delivery',
          citations: [
            {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          ],
        },
      ],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_d03c06d4af3df5d94a7f6c63',
          literals: [
            { name: 'claim_nonreceipt', negated: false },
            { name: 'decision_accept_claim', negated: false },
          ],
          applied_rules: ['buyer_nonreceipt'],
          defeated_rules: [],
          decisions: ['accept_claim'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: claim_nonreceipt\nopposite(0,1).\n% literal 1: -claim_nonreceipt\nopposite(1,0).\n% literal 2: decision_accept_claim\nopposite(2,3).\n% literal 3: -decision_accept_claim\nopposite(3,2).\n% literal 4: decision_provide_evidence\nopposite(4,5).\n% literal 5: -decision_provide_evidence\nopposite(5,4).\n% literal 6: delivery_verified\nopposite(6,7).\n% literal 7: -delivery_verified\nopposite(7,6).\n% literal 8: tracking_invalid\nopposite(8,9).\n% literal 9: -tracking_invalid\nopposite(9,8).\nfact(0,0).\n% rule 0: buyer_nonreceipt\nkind(0,defeasible).\nhead(0,2).\napplicable(0) :- holds(0).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,4).\napplicable(1) :- holds(3).\n% rule 2: invalid_tracking\nkind(2,defeater).\nhead(2,2).\napplicable(2) :- holds(8).\n% rule 3: seller_delivery\nkind(3,defeasible).\nhead(3,3).\napplicable(3) :- holds(6), not holds(8).\nhigher(2,3).\nhigher(3,0).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: 'bc0dff2a8820b90ee64685ed474a58942bd8ad121fe563c1d7c39287e102b25f',
      skeptical: [
        { name: 'claim_nonreceipt', negated: false },
        { name: 'decision_accept_claim', negated: false },
      ],
      credulous: [
        { name: 'claim_nonreceipt', negated: false },
        { name: 'decision_accept_claim', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_d03c06d4af3df5d94a7f6c63:buyer_nonreceipt',
            kind: 'application',
            label: 'buyer_nonreceipt',
            data: {
              model_id: 'm_d03c06d4af3df5d94a7f6c63',
              rule_id: 'buyer_nonreceipt',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            kind: 'citation',
            label: 'invalid_tracking',
            data: {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          },
          {
            id: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            kind: 'citation',
            label: 'delivery_priority',
            data: {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          },
          {
            id: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            kind: 'citation',
            label: 'invalid_priority',
            data: {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          },
          {
            id: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            kind: 'citation',
            label: 'seller_delivery',
            data: {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          },
          {
            id: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            kind: 'citation',
            label: 'buyer_nonreceipt',
            data: {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-claim_nonreceipt',
            kind: 'literal',
            label: '-claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: true },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-delivery_verified',
            kind: 'literal',
            label: '-delivery_verified',
            data: { name: 'delivery_verified', negated: true },
          },
          {
            id: 'literal:-tracking_invalid',
            kind: 'literal',
            label: '-tracking_invalid',
            data: { name: 'tracking_invalid', negated: true },
          },
          {
            id: 'literal:claim_nonreceipt',
            kind: 'literal',
            label: 'claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: false },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:delivery_verified',
            kind: 'literal',
            label: 'delivery_verified',
            data: { name: 'delivery_verified', negated: false },
          },
          {
            id: 'literal:tracking_invalid',
            kind: 'literal',
            label: 'tracking_invalid',
            data: { name: 'tracking_invalid', negated: false },
          },
          {
            id: 'model:m_d03c06d4af3df5d94a7f6c63',
            kind: 'stable_model',
            label: 'm_d03c06d4af3df5d94a7f6c63',
            data: {
              id: 'm_d03c06d4af3df5d94a7f6c63',
              literals: [
                { name: 'claim_nonreceipt', negated: false },
                { name: 'decision_accept_claim', negated: false },
              ],
              applied_rules: ['buyer_nonreceipt'],
              defeated_rules: [],
              decisions: ['accept_claim'],
            },
          },
          {
            id: 'priority:0',
            kind: 'priority',
            label: 'invalid_tracking > seller_delivery',
            data: {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          },
          {
            id: 'priority:1',
            kind: 'priority',
            label: 'seller_delivery > buyer_nonreceipt',
            data: {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: 'bc0dff2a8820b90ee64685ed474a58942bd8ad121fe563c1d7c39287e102b25f',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_nonreceipt',
            kind: 'rule',
            label: 'buyer_nonreceipt',
            data: {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:invalid_tracking',
            kind: 'rule',
            label: 'invalid_tracking',
            data: {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_delivery',
            kind: 'rule',
            label: 'seller_delivery',
            data: {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_d03c06d4af3df5d94a7f6c63:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            target: 'rule:invalid_tracking',
            relation: 'grounds',
          },
          {
            source: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            target: 'priority:1',
            relation: 'grounds',
          },
          {
            source: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            target: 'priority:0',
            relation: 'grounds',
          },
          {
            source: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            target: 'rule:seller_delivery',
            relation: 'grounds',
          },
          {
            source: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            target: 'rule:buyer_nonreceipt',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:claim_nonreceipt', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'application:m_d03c06d4af3df5d94a7f6c63:buyer_nonreceipt',
            relation: 'supports',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'premise',
          },
          {
            source: 'literal:delivery_verified',
            target: 'rule:seller_delivery',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:invalid_tracking',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:seller_delivery',
            relation: 'exception',
          },
          {
            source: 'model:m_d03c06d4af3df5d94a7f6c63',
            target: 'application:m_d03c06d4af3df5d94a7f6c63:buyer_nonreceipt',
            relation: 'includes',
          },
          {
            source: 'model:m_d03c06d4af3df5d94a7f6c63',
            target: 'literal:claim_nonreceipt',
            relation: 'contains',
          },
          {
            source: 'model:m_d03c06d4af3df5d94a7f6c63',
            target: 'literal:decision_accept_claim',
            relation: 'contains',
          },
          { source: 'priority:0', target: 'rule:invalid_tracking', relation: 'higher' },
          { source: 'priority:0', target: 'rule:seller_delivery', relation: 'lower' },
          { source: 'priority:1', target: 'rule:buyer_nonreceipt', relation: 'lower' },
          { source: 'priority:1', target: 'rule:seller_delivery', relation: 'higher' },
          {
            source: 'reasoning',
            target: 'model:m_d03c06d4af3df5d94a7f6c63',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'application:m_d03c06d4af3df5d94a7f6c63:buyer_nonreceipt',
            relation: 'instantiates',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'rule:seller_delivery',
            relation: 'overrides',
          },
          {
            source: 'rule:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:seller_delivery',
            target: 'rule:buyer_nonreceipt',
            relation: 'overrides',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: 'accept_claim',
      confidence: 1.0,
      requires_human: true,
      reasons: [
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 1.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: 'bc0dff2a8820b90ee64685ed474a58942bd8ad121fe563c1d7c39287e102b25f',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  delivery_verified: {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'buyer_nonreceipt',
          section_path: ['Nonreceipt demonstration', 'Buyer nonreceipt recommendation'],
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9ce64b341df5d7a544255071d3cd124a2609e8c272c0b8510e7978a3b8d10dbc',
        },
        {
          id: 'seller_delivery',
          section_path: ['Nonreceipt demonstration', 'Verified delivery exception'],
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '902d571303408fda88adad2b0ea0d5ea3f7b33bd1204064f2d1ed24ee3cf68ed',
        },
        {
          id: 'invalid_tracking',
          section_path: ['Nonreceipt demonstration', 'Invalid tracking defeater'],
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '38e8e38ce2d89f2cfbc993dfdfb34e2a58075620fb046d8cf4ad7fc8c686161e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'delivery_verified', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_nonreceipt',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'claim_nonreceipt', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          ],
        },
        {
          id: 'seller_delivery',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'delivery_verified', negated: false }],
          unless: [{ name: 'tracking_invalid', negated: false }],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          ],
        },
        {
          id: 'invalid_tracking',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'tracking_invalid', negated: false }],
          unless: [],
          kind: 'defeater',
          citations: [
            {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [
        {
          higher: 'seller_delivery',
          lower: 'buyer_nonreceipt',
          citations: [
            {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          ],
        },
        {
          higher: 'invalid_tracking',
          lower: 'seller_delivery',
          citations: [
            {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          ],
        },
      ],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_6be93ac34c69766330a25337',
          literals: [
            { name: 'decision_accept_claim', negated: true },
            { name: 'decision_provide_evidence', negated: false },
            { name: 'delivery_verified', negated: false },
          ],
          applied_rules: ['contest_action', 'seller_delivery'],
          defeated_rules: [],
          decisions: ['provide_evidence'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: claim_nonreceipt\nopposite(0,1).\n% literal 1: -claim_nonreceipt\nopposite(1,0).\n% literal 2: decision_accept_claim\nopposite(2,3).\n% literal 3: -decision_accept_claim\nopposite(3,2).\n% literal 4: decision_provide_evidence\nopposite(4,5).\n% literal 5: -decision_provide_evidence\nopposite(5,4).\n% literal 6: delivery_verified\nopposite(6,7).\n% literal 7: -delivery_verified\nopposite(7,6).\n% literal 8: tracking_invalid\nopposite(8,9).\n% literal 9: -tracking_invalid\nopposite(9,8).\nfact(0,6).\n% rule 0: buyer_nonreceipt\nkind(0,defeasible).\nhead(0,2).\napplicable(0) :- holds(0).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,4).\napplicable(1) :- holds(3).\n% rule 2: invalid_tracking\nkind(2,defeater).\nhead(2,2).\napplicable(2) :- holds(8).\n% rule 3: seller_delivery\nkind(3,defeasible).\nhead(3,3).\napplicable(3) :- holds(6), not holds(8).\nhigher(2,3).\nhigher(3,0).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: 'b49ab5d74e78f87d0d188095fc21ab3bcd19ac6b2967afd5e5ecb49f6a95b17c',
      skeptical: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'delivery_verified', negated: false },
      ],
      credulous: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'delivery_verified', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_6be93ac34c69766330a25337:contest_action',
            kind: 'application',
            label: 'contest_action',
            data: {
              model_id: 'm_6be93ac34c69766330a25337',
              rule_id: 'contest_action',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'application:m_6be93ac34c69766330a25337:seller_delivery',
            kind: 'application',
            label: 'seller_delivery',
            data: {
              model_id: 'm_6be93ac34c69766330a25337',
              rule_id: 'seller_delivery',
              derives_head: true,
              absent_exceptions: ['tracking_invalid'],
            },
          },
          {
            id: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            kind: 'citation',
            label: 'invalid_tracking',
            data: {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          },
          {
            id: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            kind: 'citation',
            label: 'delivery_priority',
            data: {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          },
          {
            id: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            kind: 'citation',
            label: 'invalid_priority',
            data: {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          },
          {
            id: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            kind: 'citation',
            label: 'seller_delivery',
            data: {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          },
          {
            id: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            kind: 'citation',
            label: 'buyer_nonreceipt',
            data: {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-claim_nonreceipt',
            kind: 'literal',
            label: '-claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: true },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-delivery_verified',
            kind: 'literal',
            label: '-delivery_verified',
            data: { name: 'delivery_verified', negated: true },
          },
          {
            id: 'literal:-tracking_invalid',
            kind: 'literal',
            label: '-tracking_invalid',
            data: { name: 'tracking_invalid', negated: true },
          },
          {
            id: 'literal:claim_nonreceipt',
            kind: 'literal',
            label: 'claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: false },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:delivery_verified',
            kind: 'literal',
            label: 'delivery_verified',
            data: { name: 'delivery_verified', negated: false },
          },
          {
            id: 'literal:tracking_invalid',
            kind: 'literal',
            label: 'tracking_invalid',
            data: { name: 'tracking_invalid', negated: false },
          },
          {
            id: 'model:m_6be93ac34c69766330a25337',
            kind: 'stable_model',
            label: 'm_6be93ac34c69766330a25337',
            data: {
              id: 'm_6be93ac34c69766330a25337',
              literals: [
                { name: 'decision_accept_claim', negated: true },
                { name: 'decision_provide_evidence', negated: false },
                { name: 'delivery_verified', negated: false },
              ],
              applied_rules: ['contest_action', 'seller_delivery'],
              defeated_rules: [],
              decisions: ['provide_evidence'],
            },
          },
          {
            id: 'priority:0',
            kind: 'priority',
            label: 'invalid_tracking > seller_delivery',
            data: {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          },
          {
            id: 'priority:1',
            kind: 'priority',
            label: 'seller_delivery > buyer_nonreceipt',
            data: {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: 'b49ab5d74e78f87d0d188095fc21ab3bcd19ac6b2967afd5e5ecb49f6a95b17c',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_nonreceipt',
            kind: 'rule',
            label: 'buyer_nonreceipt',
            data: {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:invalid_tracking',
            kind: 'rule',
            label: 'invalid_tracking',
            data: {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_delivery',
            kind: 'rule',
            label: 'seller_delivery',
            data: {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_6be93ac34c69766330a25337:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'derives',
          },
          {
            source: 'application:m_6be93ac34c69766330a25337:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            target: 'rule:invalid_tracking',
            relation: 'grounds',
          },
          {
            source: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            target: 'priority:1',
            relation: 'grounds',
          },
          {
            source: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            target: 'priority:0',
            relation: 'grounds',
          },
          {
            source: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            target: 'rule:seller_delivery',
            relation: 'grounds',
          },
          {
            source: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            target: 'rule:buyer_nonreceipt',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:delivery_verified', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'application:m_6be93ac34c69766330a25337:contest_action',
            relation: 'supports',
          },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'premise',
          },
          {
            source: 'literal:delivery_verified',
            target: 'application:m_6be93ac34c69766330a25337:seller_delivery',
            relation: 'supports',
          },
          {
            source: 'literal:delivery_verified',
            target: 'rule:seller_delivery',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:invalid_tracking',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:seller_delivery',
            relation: 'exception',
          },
          {
            source: 'model:m_6be93ac34c69766330a25337',
            target: 'application:m_6be93ac34c69766330a25337:contest_action',
            relation: 'includes',
          },
          {
            source: 'model:m_6be93ac34c69766330a25337',
            target: 'application:m_6be93ac34c69766330a25337:seller_delivery',
            relation: 'includes',
          },
          {
            source: 'model:m_6be93ac34c69766330a25337',
            target: 'literal:-decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_6be93ac34c69766330a25337',
            target: 'literal:decision_provide_evidence',
            relation: 'contains',
          },
          {
            source: 'model:m_6be93ac34c69766330a25337',
            target: 'literal:delivery_verified',
            relation: 'contains',
          },
          { source: 'priority:0', target: 'rule:invalid_tracking', relation: 'higher' },
          { source: 'priority:0', target: 'rule:seller_delivery', relation: 'lower' },
          { source: 'priority:1', target: 'rule:buyer_nonreceipt', relation: 'lower' },
          { source: 'priority:1', target: 'rule:seller_delivery', relation: 'higher' },
          {
            source: 'reasoning',
            target: 'model:m_6be93ac34c69766330a25337',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'application:m_6be93ac34c69766330a25337:contest_action',
            relation: 'instantiates',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'rule:seller_delivery',
            relation: 'overrides',
          },
          {
            source: 'rule:seller_delivery',
            target: 'application:m_6be93ac34c69766330a25337:seller_delivery',
            relation: 'instantiates',
          },
          {
            source: 'rule:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:seller_delivery',
            target: 'rule:buyer_nonreceipt',
            relation: 'overrides',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: 'provide_evidence',
      confidence: 1.0,
      requires_human: true,
      reasons: [
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 1.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: 'b49ab5d74e78f87d0d188095fc21ab3bcd19ac6b2967afd5e5ecb49f6a95b17c',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  '-delivery_verified|claim_nonreceipt|delivery_verified': {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'buyer_nonreceipt',
          section_path: ['Nonreceipt demonstration', 'Buyer nonreceipt recommendation'],
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9ce64b341df5d7a544255071d3cd124a2609e8c272c0b8510e7978a3b8d10dbc',
        },
        {
          id: 'seller_delivery',
          section_path: ['Nonreceipt demonstration', 'Verified delivery exception'],
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '902d571303408fda88adad2b0ea0d5ea3f7b33bd1204064f2d1ed24ee3cf68ed',
        },
        {
          id: 'invalid_tracking',
          section_path: ['Nonreceipt demonstration', 'Invalid tracking defeater'],
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '38e8e38ce2d89f2cfbc993dfdfb34e2a58075620fb046d8cf4ad7fc8c686161e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'delivery_verified', negated: true },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
        {
          id: 'fact_2',
          literal: { name: 'claim_nonreceipt', negated: false },
          evidence_ids: ['fixture_1'],
          confidence: 1.0,
        },
        {
          id: 'fact_3',
          literal: { name: 'delivery_verified', negated: false },
          evidence_ids: ['fixture_2'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_nonreceipt',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'claim_nonreceipt', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          ],
        },
        {
          id: 'seller_delivery',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'delivery_verified', negated: false }],
          unless: [{ name: 'tracking_invalid', negated: false }],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          ],
        },
        {
          id: 'invalid_tracking',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'tracking_invalid', negated: false }],
          unless: [],
          kind: 'defeater',
          citations: [
            {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [
        {
          higher: 'seller_delivery',
          lower: 'buyer_nonreceipt',
          citations: [
            {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          ],
        },
        {
          higher: 'invalid_tracking',
          lower: 'seller_delivery',
          citations: [
            {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          ],
        },
      ],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
        'Self-correction retained all verified fixture facts; contradictory evidence requires human review.',
      ],
    },
    solver: {
      status: 'inconsistent',
      models: [],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: claim_nonreceipt\nopposite(0,1).\n% literal 1: -claim_nonreceipt\nopposite(1,0).\n% literal 2: decision_accept_claim\nopposite(2,3).\n% literal 3: -decision_accept_claim\nopposite(3,2).\n% literal 4: decision_provide_evidence\nopposite(4,5).\n% literal 5: -decision_provide_evidence\nopposite(5,4).\n% literal 6: delivery_verified\nopposite(6,7).\n% literal 7: -delivery_verified\nopposite(7,6).\n% literal 8: tracking_invalid\nopposite(8,9).\n% literal 9: -tracking_invalid\nopposite(9,8).\nfact(0,7).\nfact(1,0).\nfact(2,6).\n% rule 0: buyer_nonreceipt\nkind(0,defeasible).\nhead(0,2).\napplicable(0) :- holds(0).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,4).\napplicable(1) :- holds(3).\n% rule 2: invalid_tracking\nkind(2,defeater).\nhead(2,2).\napplicable(2) :- holds(8).\n% rule 3: seller_delivery\nkind(3,defeasible).\nhead(3,3).\napplicable(3) :- holds(6), not holds(8).\nhigher(2,3).\nhigher(3,0).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: '220500f6d17cca240efe0ab54ea227472da6b240841f340ae7a8e1c678c235e9',
      skeptical: [],
      credulous: [],
      proof: {
        nodes: [
          {
            id: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            kind: 'citation',
            label: 'invalid_tracking',
            data: {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          },
          {
            id: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            kind: 'citation',
            label: 'delivery_priority',
            data: {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          },
          {
            id: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            kind: 'citation',
            label: 'invalid_priority',
            data: {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          },
          {
            id: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            kind: 'citation',
            label: 'seller_delivery',
            data: {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          },
          {
            id: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            kind: 'citation',
            label: 'buyer_nonreceipt',
            data: {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'evidence:fixture_1',
            kind: 'evidence',
            label: 'fixture_1',
            data: { evidence_id: 'fixture_1' },
          },
          {
            id: 'evidence:fixture_2',
            kind: 'evidence',
            label: 'fixture_2',
            data: { evidence_id: 'fixture_2' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'delivery_verified', negated: true },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'fact:fact_2',
            kind: 'fact',
            label: 'fact_2',
            data: {
              id: 'fact_2',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
          },
          {
            id: 'fact:fact_3',
            kind: 'fact',
            label: 'fact_3',
            data: {
              id: 'fact_3',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_2'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-claim_nonreceipt',
            kind: 'literal',
            label: '-claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: true },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-delivery_verified',
            kind: 'literal',
            label: '-delivery_verified',
            data: { name: 'delivery_verified', negated: true },
          },
          {
            id: 'literal:-tracking_invalid',
            kind: 'literal',
            label: '-tracking_invalid',
            data: { name: 'tracking_invalid', negated: true },
          },
          {
            id: 'literal:claim_nonreceipt',
            kind: 'literal',
            label: 'claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: false },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:delivery_verified',
            kind: 'literal',
            label: 'delivery_verified',
            data: { name: 'delivery_verified', negated: false },
          },
          {
            id: 'literal:tracking_invalid',
            kind: 'literal',
            label: 'tracking_invalid',
            data: { name: 'tracking_invalid', negated: false },
          },
          {
            id: 'priority:0',
            kind: 'priority',
            label: 'invalid_tracking > seller_delivery',
            data: {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          },
          {
            id: 'priority:1',
            kind: 'priority',
            label: 'seller_delivery > buyer_nonreceipt',
            data: {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'inconsistent',
            data: {
              program_sha256: '220500f6d17cca240efe0ab54ea227472da6b240841f340ae7a8e1c678c235e9',
              status: 'inconsistent',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_nonreceipt',
            kind: 'rule',
            label: 'buyer_nonreceipt',
            data: {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:invalid_tracking',
            kind: 'rule',
            label: 'invalid_tracking',
            data: {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_delivery',
            kind: 'rule',
            label: 'seller_delivery',
            data: {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            target: 'rule:invalid_tracking',
            relation: 'grounds',
          },
          {
            source: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            target: 'priority:1',
            relation: 'grounds',
          },
          {
            source: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            target: 'priority:0',
            relation: 'grounds',
          },
          {
            source: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            target: 'rule:seller_delivery',
            relation: 'grounds',
          },
          {
            source: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            target: 'rule:buyer_nonreceipt',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'evidence:fixture_1', target: 'fact:fact_2', relation: 'supports' },
          { source: 'evidence:fixture_2', target: 'fact:fact_3', relation: 'supports' },
          { source: 'fact:fact_1', target: 'fact:fact_3', relation: 'contradicts' },
          { source: 'fact:fact_1', target: 'literal:-delivery_verified', relation: 'asserts' },
          { source: 'fact:fact_2', target: 'literal:claim_nonreceipt', relation: 'asserts' },
          { source: 'fact:fact_3', target: 'fact:fact_1', relation: 'contradicts' },
          { source: 'fact:fact_3', target: 'literal:delivery_verified', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'premise',
          },
          {
            source: 'literal:delivery_verified',
            target: 'rule:seller_delivery',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:invalid_tracking',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:seller_delivery',
            relation: 'exception',
          },
          { source: 'priority:0', target: 'rule:invalid_tracking', relation: 'higher' },
          { source: 'priority:0', target: 'rule:seller_delivery', relation: 'lower' },
          { source: 'priority:1', target: 'rule:buyer_nonreceipt', relation: 'lower' },
          { source: 'priority:1', target: 'rule:seller_delivery', relation: 'higher' },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'rule:seller_delivery',
            relation: 'overrides',
          },
          {
            source: 'rule:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:seller_delivery',
            target: 'rule:buyer_nonreceipt',
            relation: 'overrides',
          },
        ],
      },
      diagnostics: [
        'The theory has no consistent stable model; review evidence and extracted rules.',
      ],
    },
    governance: {
      recommended_action: null,
      confidence: 0.0,
      requires_human: true,
      reasons: [
        "Solver status 'inconsistent' requires human review",
        'No unambiguous executable merchant action',
        'Operational confidence is below the automatic execution threshold',
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 0.0,
        complete_enumeration: 0.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'inconsistent',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'delivery_verified', negated: true },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
            {
              id: 'fact_2',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
            {
              id: 'fact_3',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_2'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: '220500f6d17cca240efe0ab54ea227472da6b240841f340ae7a8e1c678c235e9',
        diagnostics: [
          'The theory has no consistent stable model; review evidence and extracted rules.',
        ],
      },
      {
        attempt: 1,
        status: 'inconsistent',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'delivery_verified', negated: true },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
            {
              id: 'fact_2',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
            {
              id: 'fact_3',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_2'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
            'Self-correction retained all verified fixture facts; contradictory evidence requires human review.',
          ],
        },
        program_sha256: '220500f6d17cca240efe0ab54ea227472da6b240841f340ae7a8e1c678c235e9',
        diagnostics: [
          'The theory has no consistent stable model; review evidence and extracted rules.',
        ],
      },
      {
        attempt: 2,
        status: 'inconsistent',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'delivery_verified', negated: true },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
            {
              id: 'fact_2',
              literal: { name: 'claim_nonreceipt', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
            {
              id: 'fact_3',
              literal: { name: 'delivery_verified', negated: false },
              evidence_ids: ['fixture_2'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
            'Self-correction retained all verified fixture facts; contradictory evidence requires human review.',
          ],
        },
        program_sha256: '220500f6d17cca240efe0ab54ea227472da6b240841f340ae7a8e1c678c235e9',
        diagnostics: [
          'The theory has no consistent stable model; review evidence and extracted rules.',
        ],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  'quality_complaint|seller_inspection': {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'buyer_quality',
          section_path: ['Competing quality evidence demonstration', 'Buyer quality complaint'],
          title: 'Buyer quality complaint',
          text: 'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '6a0bc3725c1d1fb2f0ce5c6963d88cd80bb77e0483d8abf146e7289a3cb357dd',
        },
        {
          id: 'seller_quality',
          section_path: ['Competing quality evidence demonstration', 'Competing seller inspection'],
          title: 'Competing seller inspection',
          text: 'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '73aabb72ad17690ae2bc554f433c230ea164dcc6b8b051f75b2cccdc0569518a',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Competing quality evidence demonstration'],
          offered: ['buyer_quality', 'seller_quality'],
          selected: ['buyer_quality', 'seller_quality'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'quality_complaint', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
        {
          id: 'fact_2',
          literal: { name: 'seller_inspection', negated: false },
          evidence_ids: ['fixture_1'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_quality',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'quality_complaint', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_quality',
              quote:
                'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
            },
          ],
        },
        {
          id: 'seller_quality',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'seller_inspection', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_quality',
              quote:
                'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'multiple',
      models: [
        {
          id: 'm_00bbc2eaf05e3413dfc020c9',
          literals: [
            { name: 'decision_accept_claim', negated: true },
            { name: 'decision_provide_evidence', negated: false },
            { name: 'quality_complaint', negated: false },
            { name: 'seller_inspection', negated: false },
          ],
          applied_rules: ['contest_action', 'seller_quality'],
          defeated_rules: ['buyer_quality'],
          decisions: ['provide_evidence'],
        },
        {
          id: 'm_151a84788e0eb9ccbabcc997',
          literals: [
            { name: 'decision_accept_claim', negated: false },
            { name: 'quality_complaint', negated: false },
            { name: 'seller_inspection', negated: false },
          ],
          applied_rules: ['buyer_quality'],
          defeated_rules: ['seller_quality'],
          decisions: ['accept_claim'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: decision_accept_claim\nopposite(0,1).\n% literal 1: -decision_accept_claim\nopposite(1,0).\n% literal 2: decision_provide_evidence\nopposite(2,3).\n% literal 3: -decision_provide_evidence\nopposite(3,2).\n% literal 4: quality_complaint\nopposite(4,5).\n% literal 5: -quality_complaint\nopposite(5,4).\n% literal 6: seller_inspection\nopposite(6,7).\n% literal 7: -seller_inspection\nopposite(7,6).\nfact(0,4).\nfact(1,6).\n% rule 0: buyer_quality\nkind(0,defeasible).\nhead(0,0).\napplicable(0) :- holds(4).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,2).\napplicable(1) :- holds(1).\n% rule 2: seller_quality\nkind(2,defeasible).\nhead(2,1).\napplicable(2) :- holds(6).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: '24576baa32822c742950ba16e177a65c0550de913d916199a2768a6483104cf9',
      skeptical: [
        { name: 'quality_complaint', negated: false },
        { name: 'seller_inspection', negated: false },
      ],
      credulous: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'decision_accept_claim', negated: false },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'quality_complaint', negated: false },
        { name: 'seller_inspection', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_00bbc2eaf05e3413dfc020c9:contest_action',
            kind: 'application',
            label: 'contest_action',
            data: {
              model_id: 'm_00bbc2eaf05e3413dfc020c9',
              rule_id: 'contest_action',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'application:m_00bbc2eaf05e3413dfc020c9:seller_quality',
            kind: 'application',
            label: 'seller_quality',
            data: {
              model_id: 'm_00bbc2eaf05e3413dfc020c9',
              rule_id: 'seller_quality',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'application:m_151a84788e0eb9ccbabcc997:buyer_quality',
            kind: 'application',
            label: 'buyer_quality',
            data: {
              model_id: 'm_151a84788e0eb9ccbabcc997',
              rule_id: 'buyer_quality',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'citation:b14a831230497c298baf0813368aee75637eed994276536b2f6765930192bb7a',
            kind: 'citation',
            label: 'seller_quality',
            data: {
              clause_id: 'seller_quality',
              quote:
                'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'citation:e7f56795c3d48edda1a5d7a49d9d88b7f2943709c3742340618620266515e14d',
            kind: 'citation',
            label: 'buyer_quality',
            data: {
              clause_id: 'buyer_quality',
              quote:
                'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
            },
          },
          {
            id: 'defeat:m_00bbc2eaf05e3413dfc020c9:buyer_quality',
            kind: 'defeat',
            label: 'buyer_quality',
            data: { model_id: 'm_00bbc2eaf05e3413dfc020c9', rule_id: 'buyer_quality' },
          },
          {
            id: 'defeat:m_151a84788e0eb9ccbabcc997:seller_quality',
            kind: 'defeat',
            label: 'seller_quality',
            data: { model_id: 'm_151a84788e0eb9ccbabcc997', rule_id: 'seller_quality' },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'evidence:fixture_1',
            kind: 'evidence',
            label: 'fixture_1',
            data: { evidence_id: 'fixture_1' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'quality_complaint', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'fact:fact_2',
            kind: 'fact',
            label: 'fact_2',
            data: {
              id: 'fact_2',
              literal: { name: 'seller_inspection', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-quality_complaint',
            kind: 'literal',
            label: '-quality_complaint',
            data: { name: 'quality_complaint', negated: true },
          },
          {
            id: 'literal:-seller_inspection',
            kind: 'literal',
            label: '-seller_inspection',
            data: { name: 'seller_inspection', negated: true },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:quality_complaint',
            kind: 'literal',
            label: 'quality_complaint',
            data: { name: 'quality_complaint', negated: false },
          },
          {
            id: 'literal:seller_inspection',
            kind: 'literal',
            label: 'seller_inspection',
            data: { name: 'seller_inspection', negated: false },
          },
          {
            id: 'model:m_00bbc2eaf05e3413dfc020c9',
            kind: 'stable_model',
            label: 'm_00bbc2eaf05e3413dfc020c9',
            data: {
              id: 'm_00bbc2eaf05e3413dfc020c9',
              literals: [
                { name: 'decision_accept_claim', negated: true },
                { name: 'decision_provide_evidence', negated: false },
                { name: 'quality_complaint', negated: false },
                { name: 'seller_inspection', negated: false },
              ],
              applied_rules: ['contest_action', 'seller_quality'],
              defeated_rules: ['buyer_quality'],
              decisions: ['provide_evidence'],
            },
          },
          {
            id: 'model:m_151a84788e0eb9ccbabcc997',
            kind: 'stable_model',
            label: 'm_151a84788e0eb9ccbabcc997',
            data: {
              id: 'm_151a84788e0eb9ccbabcc997',
              literals: [
                { name: 'decision_accept_claim', negated: false },
                { name: 'quality_complaint', negated: false },
                { name: 'seller_inspection', negated: false },
              ],
              applied_rules: ['buyer_quality'],
              defeated_rules: ['seller_quality'],
              decisions: ['accept_claim'],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'multiple',
            data: {
              program_sha256: '24576baa32822c742950ba16e177a65c0550de913d916199a2768a6483104cf9',
              status: 'multiple',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_quality',
            kind: 'rule',
            label: 'buyer_quality',
            data: {
              id: 'buyer_quality',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'quality_complaint', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_quality',
                  quote:
                    'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_quality',
            kind: 'rule',
            label: 'seller_quality',
            data: {
              id: 'seller_quality',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'seller_inspection', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_quality',
                  quote:
                    'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_00bbc2eaf05e3413dfc020c9:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'derives',
          },
          {
            source: 'application:m_00bbc2eaf05e3413dfc020c9:seller_quality',
            target: 'defeat:m_00bbc2eaf05e3413dfc020c9:buyer_quality',
            relation: 'opposing_rule',
          },
          {
            source: 'application:m_00bbc2eaf05e3413dfc020c9:seller_quality',
            target: 'literal:-decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'application:m_151a84788e0eb9ccbabcc997:buyer_quality',
            target: 'defeat:m_151a84788e0eb9ccbabcc997:seller_quality',
            relation: 'opposing_rule',
          },
          {
            source: 'application:m_151a84788e0eb9ccbabcc997:buyer_quality',
            target: 'literal:decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'citation:b14a831230497c298baf0813368aee75637eed994276536b2f6765930192bb7a',
            target: 'rule:seller_quality',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          {
            source: 'citation:e7f56795c3d48edda1a5d7a49d9d88b7f2943709c3742340618620266515e14d',
            target: 'rule:buyer_quality',
            relation: 'grounds',
          },
          {
            source: 'defeat:m_00bbc2eaf05e3413dfc020c9:buyer_quality',
            target: 'rule:buyer_quality',
            relation: 'defeats',
          },
          {
            source: 'defeat:m_151a84788e0eb9ccbabcc997:seller_quality',
            target: 'rule:seller_quality',
            relation: 'defeats',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'evidence:fixture_1', target: 'fact:fact_2', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:quality_complaint', relation: 'asserts' },
          { source: 'fact:fact_2', target: 'literal:seller_inspection', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'application:m_00bbc2eaf05e3413dfc020c9:contest_action',
            relation: 'supports',
          },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:quality_complaint',
            target: 'application:m_151a84788e0eb9ccbabcc997:buyer_quality',
            relation: 'supports',
          },
          {
            source: 'literal:quality_complaint',
            target: 'rule:buyer_quality',
            relation: 'premise',
          },
          {
            source: 'literal:seller_inspection',
            target: 'application:m_00bbc2eaf05e3413dfc020c9:seller_quality',
            relation: 'supports',
          },
          {
            source: 'literal:seller_inspection',
            target: 'rule:seller_quality',
            relation: 'premise',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'application:m_00bbc2eaf05e3413dfc020c9:contest_action',
            relation: 'includes',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'application:m_00bbc2eaf05e3413dfc020c9:seller_quality',
            relation: 'includes',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'defeat:m_00bbc2eaf05e3413dfc020c9:buyer_quality',
            relation: 'includes',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'literal:-decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'literal:decision_provide_evidence',
            relation: 'contains',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'literal:quality_complaint',
            relation: 'contains',
          },
          {
            source: 'model:m_00bbc2eaf05e3413dfc020c9',
            target: 'literal:seller_inspection',
            relation: 'contains',
          },
          {
            source: 'model:m_151a84788e0eb9ccbabcc997',
            target: 'application:m_151a84788e0eb9ccbabcc997:buyer_quality',
            relation: 'includes',
          },
          {
            source: 'model:m_151a84788e0eb9ccbabcc997',
            target: 'defeat:m_151a84788e0eb9ccbabcc997:seller_quality',
            relation: 'includes',
          },
          {
            source: 'model:m_151a84788e0eb9ccbabcc997',
            target: 'literal:decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_151a84788e0eb9ccbabcc997',
            target: 'literal:quality_complaint',
            relation: 'contains',
          },
          {
            source: 'model:m_151a84788e0eb9ccbabcc997',
            target: 'literal:seller_inspection',
            relation: 'contains',
          },
          {
            source: 'reasoning',
            target: 'model:m_00bbc2eaf05e3413dfc020c9',
            relation: 'extension',
          },
          {
            source: 'reasoning',
            target: 'model:m_151a84788e0eb9ccbabcc997',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_quality',
            target: 'application:m_151a84788e0eb9ccbabcc997:buyer_quality',
            relation: 'instantiates',
          },
          {
            source: 'rule:buyer_quality',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'application:m_00bbc2eaf05e3413dfc020c9:contest_action',
            relation: 'instantiates',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:seller_quality',
            target: 'application:m_00bbc2eaf05e3413dfc020c9:seller_quality',
            relation: 'instantiates',
          },
          {
            source: 'rule:seller_quality',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: null,
      confidence: 0.5,
      requires_human: true,
      reasons: [
        "Solver status 'multiple' requires human review",
        'No unambiguous executable merchant action',
        'Operational confidence is below the automatic execution threshold',
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 0.5,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'multiple',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'quality_complaint', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
            {
              id: 'fact_2',
              literal: { name: 'seller_inspection', negated: false },
              evidence_ids: ['fixture_1'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_quality',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'quality_complaint', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_quality',
                  quote:
                    'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
                },
              ],
            },
            {
              id: 'seller_quality',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'seller_inspection', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_quality',
                  quote:
                    'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: '24576baa32822c742950ba16e177a65c0550de913d916199a2768a6483104cf9',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  quality_complaint: {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'buyer_quality',
          section_path: ['Competing quality evidence demonstration', 'Buyer quality complaint'],
          title: 'Buyer quality complaint',
          text: 'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '6a0bc3725c1d1fb2f0ce5c6963d88cd80bb77e0483d8abf146e7289a3cb357dd',
        },
        {
          id: 'seller_quality',
          section_path: ['Competing quality evidence demonstration', 'Competing seller inspection'],
          title: 'Competing seller inspection',
          text: 'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '73aabb72ad17690ae2bc554f433c230ea164dcc6b8b051f75b2cccdc0569518a',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Competing quality evidence demonstration'],
          offered: ['buyer_quality', 'seller_quality'],
          selected: ['buyer_quality', 'seller_quality'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'quality_complaint', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_quality',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'quality_complaint', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_quality',
              quote:
                'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
            },
          ],
        },
        {
          id: 'seller_quality',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'seller_inspection', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_quality',
              quote:
                'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_c253d88cd47f7aba83ad189d',
          literals: [
            { name: 'decision_accept_claim', negated: false },
            { name: 'quality_complaint', negated: false },
          ],
          applied_rules: ['buyer_quality'],
          defeated_rules: [],
          decisions: ['accept_claim'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: decision_accept_claim\nopposite(0,1).\n% literal 1: -decision_accept_claim\nopposite(1,0).\n% literal 2: decision_provide_evidence\nopposite(2,3).\n% literal 3: -decision_provide_evidence\nopposite(3,2).\n% literal 4: quality_complaint\nopposite(4,5).\n% literal 5: -quality_complaint\nopposite(5,4).\n% literal 6: seller_inspection\nopposite(6,7).\n% literal 7: -seller_inspection\nopposite(7,6).\nfact(0,4).\n% rule 0: buyer_quality\nkind(0,defeasible).\nhead(0,0).\napplicable(0) :- holds(4).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,2).\napplicable(1) :- holds(1).\n% rule 2: seller_quality\nkind(2,defeasible).\nhead(2,1).\napplicable(2) :- holds(6).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: '6c369a4906960a49f8b9f930ee9d95de1cd2a22551ac5247fdbdeb58a8cfe34a',
      skeptical: [
        { name: 'decision_accept_claim', negated: false },
        { name: 'quality_complaint', negated: false },
      ],
      credulous: [
        { name: 'decision_accept_claim', negated: false },
        { name: 'quality_complaint', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_c253d88cd47f7aba83ad189d:buyer_quality',
            kind: 'application',
            label: 'buyer_quality',
            data: {
              model_id: 'm_c253d88cd47f7aba83ad189d',
              rule_id: 'buyer_quality',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'citation:b14a831230497c298baf0813368aee75637eed994276536b2f6765930192bb7a',
            kind: 'citation',
            label: 'seller_quality',
            data: {
              clause_id: 'seller_quality',
              quote:
                'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'citation:e7f56795c3d48edda1a5d7a49d9d88b7f2943709c3742340618620266515e14d',
            kind: 'citation',
            label: 'buyer_quality',
            data: {
              clause_id: 'buyer_quality',
              quote:
                'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
            },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'quality_complaint', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-quality_complaint',
            kind: 'literal',
            label: '-quality_complaint',
            data: { name: 'quality_complaint', negated: true },
          },
          {
            id: 'literal:-seller_inspection',
            kind: 'literal',
            label: '-seller_inspection',
            data: { name: 'seller_inspection', negated: true },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:quality_complaint',
            kind: 'literal',
            label: 'quality_complaint',
            data: { name: 'quality_complaint', negated: false },
          },
          {
            id: 'literal:seller_inspection',
            kind: 'literal',
            label: 'seller_inspection',
            data: { name: 'seller_inspection', negated: false },
          },
          {
            id: 'model:m_c253d88cd47f7aba83ad189d',
            kind: 'stable_model',
            label: 'm_c253d88cd47f7aba83ad189d',
            data: {
              id: 'm_c253d88cd47f7aba83ad189d',
              literals: [
                { name: 'decision_accept_claim', negated: false },
                { name: 'quality_complaint', negated: false },
              ],
              applied_rules: ['buyer_quality'],
              defeated_rules: [],
              decisions: ['accept_claim'],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: '6c369a4906960a49f8b9f930ee9d95de1cd2a22551ac5247fdbdeb58a8cfe34a',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_quality',
            kind: 'rule',
            label: 'buyer_quality',
            data: {
              id: 'buyer_quality',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'quality_complaint', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_quality',
                  quote:
                    'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_quality',
            kind: 'rule',
            label: 'seller_quality',
            data: {
              id: 'seller_quality',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'seller_inspection', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_quality',
                  quote:
                    'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_c253d88cd47f7aba83ad189d:buyer_quality',
            target: 'literal:decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'citation:b14a831230497c298baf0813368aee75637eed994276536b2f6765930192bb7a',
            target: 'rule:seller_quality',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          {
            source: 'citation:e7f56795c3d48edda1a5d7a49d9d88b7f2943709c3742340618620266515e14d',
            target: 'rule:buyer_quality',
            relation: 'grounds',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:quality_complaint', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:quality_complaint',
            target: 'application:m_c253d88cd47f7aba83ad189d:buyer_quality',
            relation: 'supports',
          },
          {
            source: 'literal:quality_complaint',
            target: 'rule:buyer_quality',
            relation: 'premise',
          },
          {
            source: 'literal:seller_inspection',
            target: 'rule:seller_quality',
            relation: 'premise',
          },
          {
            source: 'model:m_c253d88cd47f7aba83ad189d',
            target: 'application:m_c253d88cd47f7aba83ad189d:buyer_quality',
            relation: 'includes',
          },
          {
            source: 'model:m_c253d88cd47f7aba83ad189d',
            target: 'literal:decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_c253d88cd47f7aba83ad189d',
            target: 'literal:quality_complaint',
            relation: 'contains',
          },
          {
            source: 'reasoning',
            target: 'model:m_c253d88cd47f7aba83ad189d',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_quality',
            target: 'application:m_c253d88cd47f7aba83ad189d:buyer_quality',
            relation: 'instantiates',
          },
          {
            source: 'rule:buyer_quality',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:seller_quality',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: 'accept_claim',
      confidence: 1.0,
      requires_human: true,
      reasons: [
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 1.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'quality_complaint', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_quality',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'quality_complaint', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_quality',
                  quote:
                    'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
                },
              ],
            },
            {
              id: 'seller_quality',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'seller_inspection', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_quality',
                  quote:
                    'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: '6c369a4906960a49f8b9f930ee9d95de1cd2a22551ac5247fdbdeb58a8cfe34a',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  seller_inspection: {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'buyer_quality',
          section_path: ['Competing quality evidence demonstration', 'Buyer quality complaint'],
          title: 'Buyer quality complaint',
          text: 'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '6a0bc3725c1d1fb2f0ce5c6963d88cd80bb77e0483d8abf146e7289a3cb357dd',
        },
        {
          id: 'seller_quality',
          section_path: ['Competing quality evidence demonstration', 'Competing seller inspection'],
          title: 'Competing seller inspection',
          text: 'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '73aabb72ad17690ae2bc554f433c230ea164dcc6b8b051f75b2cccdc0569518a',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Competing quality evidence demonstration'],
          offered: ['buyer_quality', 'seller_quality'],
          selected: ['buyer_quality', 'seller_quality'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [
        {
          id: 'fact_1',
          literal: { name: 'seller_inspection', negated: false },
          evidence_ids: ['fixture_0'],
          confidence: 1.0,
        },
      ],
      rules: [
        {
          id: 'buyer_quality',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'quality_complaint', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_quality',
              quote:
                'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
            },
          ],
        },
        {
          id: 'seller_quality',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'seller_inspection', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_quality',
              quote:
                'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [],
      confidence: 1.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_e8d6b6c9bc9bb6b04760fa70',
          literals: [
            { name: 'decision_accept_claim', negated: true },
            { name: 'decision_provide_evidence', negated: false },
            { name: 'seller_inspection', negated: false },
          ],
          applied_rules: ['contest_action', 'seller_quality'],
          defeated_rules: [],
          decisions: ['provide_evidence'],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: decision_accept_claim\nopposite(0,1).\n% literal 1: -decision_accept_claim\nopposite(1,0).\n% literal 2: decision_provide_evidence\nopposite(2,3).\n% literal 3: -decision_provide_evidence\nopposite(3,2).\n% literal 4: quality_complaint\nopposite(4,5).\n% literal 5: -quality_complaint\nopposite(5,4).\n% literal 6: seller_inspection\nopposite(6,7).\n% literal 7: -seller_inspection\nopposite(7,6).\nfact(0,6).\n% rule 0: buyer_quality\nkind(0,defeasible).\nhead(0,0).\napplicable(0) :- holds(4).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,2).\napplicable(1) :- holds(1).\n% rule 2: seller_quality\nkind(2,defeasible).\nhead(2,1).\napplicable(2) :- holds(6).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: 'f20f02a7abaec30d8617b2a2f54cbd31e776a850757592921ae35bd740426e07',
      skeptical: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'seller_inspection', negated: false },
      ],
      credulous: [
        { name: 'decision_accept_claim', negated: true },
        { name: 'decision_provide_evidence', negated: false },
        { name: 'seller_inspection', negated: false },
      ],
      proof: {
        nodes: [
          {
            id: 'application:m_e8d6b6c9bc9bb6b04760fa70:contest_action',
            kind: 'application',
            label: 'contest_action',
            data: {
              model_id: 'm_e8d6b6c9bc9bb6b04760fa70',
              rule_id: 'contest_action',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'application:m_e8d6b6c9bc9bb6b04760fa70:seller_quality',
            kind: 'application',
            label: 'seller_quality',
            data: {
              model_id: 'm_e8d6b6c9bc9bb6b04760fa70',
              rule_id: 'seller_quality',
              derives_head: true,
              absent_exceptions: [],
            },
          },
          {
            id: 'citation:b14a831230497c298baf0813368aee75637eed994276536b2f6765930192bb7a',
            kind: 'citation',
            label: 'seller_quality',
            data: {
              clause_id: 'seller_quality',
              quote:
                'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'citation:e7f56795c3d48edda1a5d7a49d9d88b7f2943709c3742340618620266515e14d',
            kind: 'citation',
            label: 'buyer_quality',
            data: {
              clause_id: 'buyer_quality',
              quote:
                'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
            },
          },
          {
            id: 'evidence:fixture_0',
            kind: 'evidence',
            label: 'fixture_0',
            data: { evidence_id: 'fixture_0' },
          },
          {
            id: 'fact:fact_1',
            kind: 'fact',
            label: 'fact_1',
            data: {
              id: 'fact_1',
              literal: { name: 'seller_inspection', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-quality_complaint',
            kind: 'literal',
            label: '-quality_complaint',
            data: { name: 'quality_complaint', negated: true },
          },
          {
            id: 'literal:-seller_inspection',
            kind: 'literal',
            label: '-seller_inspection',
            data: { name: 'seller_inspection', negated: true },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:quality_complaint',
            kind: 'literal',
            label: 'quality_complaint',
            data: { name: 'quality_complaint', negated: false },
          },
          {
            id: 'literal:seller_inspection',
            kind: 'literal',
            label: 'seller_inspection',
            data: { name: 'seller_inspection', negated: false },
          },
          {
            id: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            kind: 'stable_model',
            label: 'm_e8d6b6c9bc9bb6b04760fa70',
            data: {
              id: 'm_e8d6b6c9bc9bb6b04760fa70',
              literals: [
                { name: 'decision_accept_claim', negated: true },
                { name: 'decision_provide_evidence', negated: false },
                { name: 'seller_inspection', negated: false },
              ],
              applied_rules: ['contest_action', 'seller_quality'],
              defeated_rules: [],
              decisions: ['provide_evidence'],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: 'f20f02a7abaec30d8617b2a2f54cbd31e776a850757592921ae35bd740426e07',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_quality',
            kind: 'rule',
            label: 'buyer_quality',
            data: {
              id: 'buyer_quality',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'quality_complaint', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_quality',
                  quote:
                    'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_quality',
            kind: 'rule',
            label: 'seller_quality',
            data: {
              id: 'seller_quality',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'seller_inspection', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_quality',
                  quote:
                    'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'application:m_e8d6b6c9bc9bb6b04760fa70:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'derives',
          },
          {
            source: 'application:m_e8d6b6c9bc9bb6b04760fa70:seller_quality',
            target: 'literal:-decision_accept_claim',
            relation: 'derives',
          },
          {
            source: 'citation:b14a831230497c298baf0813368aee75637eed994276536b2f6765930192bb7a',
            target: 'rule:seller_quality',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          {
            source: 'citation:e7f56795c3d48edda1a5d7a49d9d88b7f2943709c3742340618620266515e14d',
            target: 'rule:buyer_quality',
            relation: 'grounds',
          },
          { source: 'evidence:fixture_0', target: 'fact:fact_1', relation: 'supports' },
          { source: 'fact:fact_1', target: 'literal:seller_inspection', relation: 'asserts' },
          {
            source: 'literal:-decision_accept_claim',
            target: 'application:m_e8d6b6c9bc9bb6b04760fa70:contest_action',
            relation: 'supports',
          },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:quality_complaint',
            target: 'rule:buyer_quality',
            relation: 'premise',
          },
          {
            source: 'literal:seller_inspection',
            target: 'application:m_e8d6b6c9bc9bb6b04760fa70:seller_quality',
            relation: 'supports',
          },
          {
            source: 'literal:seller_inspection',
            target: 'rule:seller_quality',
            relation: 'premise',
          },
          {
            source: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            target: 'application:m_e8d6b6c9bc9bb6b04760fa70:contest_action',
            relation: 'includes',
          },
          {
            source: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            target: 'application:m_e8d6b6c9bc9bb6b04760fa70:seller_quality',
            relation: 'includes',
          },
          {
            source: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            target: 'literal:-decision_accept_claim',
            relation: 'contains',
          },
          {
            source: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            target: 'literal:decision_provide_evidence',
            relation: 'contains',
          },
          {
            source: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            target: 'literal:seller_inspection',
            relation: 'contains',
          },
          {
            source: 'reasoning',
            target: 'model:m_e8d6b6c9bc9bb6b04760fa70',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_quality',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'application:m_e8d6b6c9bc9bb6b04760fa70:contest_action',
            relation: 'instantiates',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:seller_quality',
            target: 'application:m_e8d6b6c9bc9bb6b04760fa70:seller_quality',
            relation: 'instantiates',
          },
          {
            source: 'rule:seller_quality',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: 'provide_evidence',
      confidence: 1.0,
      requires_human: true,
      reasons: [
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 1.0,
        verified_provenance: 1.0,
        action_consensus: 1.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [
            {
              id: 'fact_1',
              literal: { name: 'seller_inspection', negated: false },
              evidence_ids: ['fixture_0'],
              confidence: 1.0,
            },
          ],
          rules: [
            {
              id: 'buyer_quality',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'quality_complaint', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_quality',
                  quote:
                    'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
                },
              ],
            },
            {
              id: 'seller_quality',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'seller_inspection', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_quality',
                  quote:
                    'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [],
          confidence: 1.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
          ],
        },
        program_sha256: 'f20f02a7abaec30d8617b2a2f54cbd31e776a850757592921ae35bd740426e07',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
  '': {
    retrieval: {
      policy_id: 'demo_policy',
      policy_version: '2026-10-demo',
      synthetic: true,
      clauses: [
        {
          id: 'demo_scope',
          section_path: ['Scope and synthetic policy disclosure'],
          title: 'Scope and synthetic policy disclosure',
          text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'c424c5aa697612d7c2e9c115b234a50fe4e11e926ecc9838e37eef1822e77b8e',
        },
        {
          id: 'buyer_nonreceipt',
          section_path: ['Nonreceipt demonstration', 'Buyer nonreceipt recommendation'],
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9ce64b341df5d7a544255071d3cd124a2609e8c272c0b8510e7978a3b8d10dbc',
        },
        {
          id: 'seller_delivery',
          section_path: ['Nonreceipt demonstration', 'Verified delivery exception'],
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '902d571303408fda88adad2b0ea0d5ea3f7b33bd1204064f2d1ed24ee3cf68ed',
        },
        {
          id: 'invalid_tracking',
          section_path: ['Nonreceipt demonstration', 'Invalid tracking defeater'],
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '38e8e38ce2d89f2cfbc993dfdfb34e2a58075620fb046d8cf4ad7fc8c686161e',
        },
        {
          id: 'delivery_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Delivery rule overrides nonreceipt rule',
          ],
          title: 'Delivery rule overrides nonreceipt rule',
          text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: 'e0e0da0deb594d4e14de999f436e71718aa0049d4ec573d226f21d72c29ed5b9',
        },
        {
          id: 'invalid_priority',
          section_path: [
            'Nonreceipt demonstration',
            'Applicable nonreceipt rule priorities',
            'Invalid tracking defeater overrides delivery rule',
          ],
          title: 'Invalid tracking defeater overrides delivery rule',
          text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '0aca27f9adfda22bb5f7778055bffc6d2c838db641132e0564d3c41a908f18c0',
        },
        {
          id: 'contest_action',
          section_path: ['Merchant evidence submission mapping'],
          title: 'Merchant evidence submission mapping',
          text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
          source_url: 'urn:disputeflow:synthetic-demo:2026-10',
          version: '2026-10-demo',
          sha256: '9fcb98ce74f19cf5aef828bf4be9486cb31d3ef114894945a410bd52905631ef',
        },
      ],
      trace: [
        {
          path: [],
          offered: ['demo_scope', 'nonreceipt', 'quality', 'contest_action'],
          selected: ['demo_scope', 'nonreceipt', 'contest_action'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration'],
          offered: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selected: ['buyer_nonreceipt', 'seller_delivery', 'invalid_tracking', 'priorities'],
          selector: 'deterministic_demo',
        },
        {
          path: ['Nonreceipt demonstration', 'Applicable nonreceipt rule priorities'],
          offered: ['delivery_priority', 'invalid_priority'],
          selected: ['delivery_priority', 'invalid_priority'],
          selector: 'deterministic_demo',
        },
      ],
    },
    knowledge_base: {
      facts: [],
      rules: [
        {
          id: 'buyer_nonreceipt',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'claim_nonreceipt', negated: false }],
          unless: [],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          ],
        },
        {
          id: 'seller_delivery',
          head: { name: 'decision_accept_claim', negated: true },
          body: [{ name: 'delivery_verified', negated: false }],
          unless: [{ name: 'tracking_invalid', negated: false }],
          kind: 'defeasible',
          citations: [
            {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          ],
        },
        {
          id: 'invalid_tracking',
          head: { name: 'decision_accept_claim', negated: false },
          body: [{ name: 'tracking_invalid', negated: false }],
          unless: [],
          kind: 'defeater',
          citations: [
            {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          ],
        },
        {
          id: 'contest_action',
          head: { name: 'decision_provide_evidence', negated: false },
          body: [{ name: 'decision_accept_claim', negated: true }],
          unless: [],
          kind: 'strict',
          citations: [
            {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          ],
        },
      ],
      priorities: [
        {
          higher: 'seller_delivery',
          lower: 'buyer_nonreceipt',
          citations: [
            {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          ],
        },
        {
          higher: 'invalid_tracking',
          lower: 'seller_delivery',
          citations: [
            {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          ],
        },
      ],
      confidence: 0.0,
      warnings: [
        'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
        'No verified supported FACT markers were supplied; no demo decision can be inferred.',
      ],
    },
    solver: {
      status: 'unique',
      models: [
        {
          id: 'm_c5d89818e444fb7a160f498c',
          literals: [],
          applied_rules: [],
          defeated_rules: [],
          decisions: [],
        },
      ],
      enumeration_complete: true,
      program:
        '% DisputeFlow propositional defeasible semantics v1\n% IDs and literals below have been validated and encoded as integers.\n% literal 0: claim_nonreceipt\nopposite(0,1).\n% literal 1: -claim_nonreceipt\nopposite(1,0).\n% literal 2: decision_accept_claim\nopposite(2,3).\n% literal 3: -decision_accept_claim\nopposite(3,2).\n% literal 4: decision_provide_evidence\nopposite(4,5).\n% literal 5: -decision_provide_evidence\nopposite(5,4).\n% literal 6: delivery_verified\nopposite(6,7).\n% literal 7: -delivery_verified\nopposite(7,6).\n% literal 8: tracking_invalid\nopposite(8,9).\n% literal 9: -tracking_invalid\nopposite(9,8).\n% rule 0: buyer_nonreceipt\nkind(0,defeasible).\nhead(0,2).\napplicable(0) :- holds(0).\n% rule 1: contest_action\nkind(1,strict).\nhead(1,4).\napplicable(1) :- holds(3).\n% rule 2: invalid_tracking\nkind(2,defeater).\nhead(2,2).\napplicable(2) :- holds(8).\n% rule 3: seller_delivery\nkind(3,defeasible).\nhead(3,3).\napplicable(3) :- holds(6), not holds(8).\nhigher(2,3).\nhigher(3,0).\n#defined fact/2.\n#defined kind/2.\n#defined head/2.\n#defined higher/2.\n#defined opposite/2.\n#defined applicable/1.\nsuperior(R,S) :- higher(R,S).\nsuperior(R,T) :- superior(R,S), higher(S,T).\nconflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.\nholds(L) :- fact(_,L).\nstrict_support(L) :- fact(_,L).\nstrict_support(L) :- kind(R,strict), applicable(R), head(R,L).\napplied(R) :- kind(R,strict), applicable(R).\napplied(R) :- kind(R,defeasible), applicable(R), not defeated(R).\napplied(R) :- kind(R,defeater), applicable(R), not defeated(R).\nholds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.\ndefeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).\ndefeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).\ndefeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).\n:- holds(L), holds(C), opposite(L,C).\n#show holds/1.\n#show applied/1.\n#show defeated/1.\n#show applicable/1.\n',
      program_sha256: '43fb926024555cb3a0a6ae95c12516d118e8314c4e6ea09e1e099332c882f72c',
      skeptical: [],
      credulous: [],
      proof: {
        nodes: [
          {
            id: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            kind: 'citation',
            label: 'invalid_tracking',
            data: {
              clause_id: 'invalid_tracking',
              quote:
                'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
            },
          },
          {
            id: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            kind: 'citation',
            label: 'delivery_priority',
            data: {
              clause_id: 'delivery_priority',
              quote:
                'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
            },
          },
          {
            id: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            kind: 'citation',
            label: 'invalid_priority',
            data: {
              clause_id: 'invalid_priority',
              quote:
                'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
            },
          },
          {
            id: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            kind: 'citation',
            label: 'seller_delivery',
            data: {
              clause_id: 'seller_delivery',
              quote:
                'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
            },
          },
          {
            id: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            kind: 'citation',
            label: 'buyer_nonreceipt',
            data: {
              clause_id: 'buyer_nonreceipt',
              quote:
                'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
            },
          },
          {
            id: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            kind: 'citation',
            label: 'contest_action',
            data: {
              clause_id: 'contest_action',
              quote:
                'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
            },
          },
          {
            id: 'literal:-claim_nonreceipt',
            kind: 'literal',
            label: '-claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: true },
          },
          {
            id: 'literal:-decision_accept_claim',
            kind: 'literal',
            label: '-decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: true },
          },
          {
            id: 'literal:-decision_provide_evidence',
            kind: 'literal',
            label: '-decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: true },
          },
          {
            id: 'literal:-delivery_verified',
            kind: 'literal',
            label: '-delivery_verified',
            data: { name: 'delivery_verified', negated: true },
          },
          {
            id: 'literal:-tracking_invalid',
            kind: 'literal',
            label: '-tracking_invalid',
            data: { name: 'tracking_invalid', negated: true },
          },
          {
            id: 'literal:claim_nonreceipt',
            kind: 'literal',
            label: 'claim_nonreceipt',
            data: { name: 'claim_nonreceipt', negated: false },
          },
          {
            id: 'literal:decision_accept_claim',
            kind: 'literal',
            label: 'decision_accept_claim',
            data: { name: 'decision_accept_claim', negated: false },
          },
          {
            id: 'literal:decision_provide_evidence',
            kind: 'literal',
            label: 'decision_provide_evidence',
            data: { name: 'decision_provide_evidence', negated: false },
          },
          {
            id: 'literal:delivery_verified',
            kind: 'literal',
            label: 'delivery_verified',
            data: { name: 'delivery_verified', negated: false },
          },
          {
            id: 'literal:tracking_invalid',
            kind: 'literal',
            label: 'tracking_invalid',
            data: { name: 'tracking_invalid', negated: false },
          },
          {
            id: 'model:m_c5d89818e444fb7a160f498c',
            kind: 'stable_model',
            label: 'm_c5d89818e444fb7a160f498c',
            data: {
              id: 'm_c5d89818e444fb7a160f498c',
              literals: [],
              applied_rules: [],
              defeated_rules: [],
              decisions: [],
            },
          },
          {
            id: 'priority:0',
            kind: 'priority',
            label: 'invalid_tracking > seller_delivery',
            data: {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          },
          {
            id: 'priority:1',
            kind: 'priority',
            label: 'seller_delivery > buyer_nonreceipt',
            data: {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
          },
          {
            id: 'reasoning',
            kind: 'reasoning',
            label: 'unique',
            data: {
              program_sha256: '43fb926024555cb3a0a6ae95c12516d118e8314c4e6ea09e1e099332c882f72c',
              status: 'unique',
              semantics_version: 1,
              enumeration_complete: true,
            },
          },
          {
            id: 'rule:buyer_nonreceipt',
            kind: 'rule',
            label: 'buyer_nonreceipt',
            data: {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
          },
          {
            id: 'rule:contest_action',
            kind: 'rule',
            label: 'contest_action',
            data: {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          },
          {
            id: 'rule:invalid_tracking',
            kind: 'rule',
            label: 'invalid_tracking',
            data: {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
          },
          {
            id: 'rule:seller_delivery',
            kind: 'rule',
            label: 'seller_delivery',
            data: {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
          },
        ],
        edges: [
          {
            source: 'citation:2ccb1c1b3dbb647d3b1905deba18591c8bdbfb65d2d54d2df8d57f1fd080ecc3',
            target: 'rule:invalid_tracking',
            relation: 'grounds',
          },
          {
            source: 'citation:31212a21627b6dd6ec1956be882f38cca93eaf347907da697af6c965b80fc09d',
            target: 'priority:1',
            relation: 'grounds',
          },
          {
            source: 'citation:3dbe744c33d7cbc514b21213e8a90a25973f4418b936fe953c8429be8f6bcb11',
            target: 'priority:0',
            relation: 'grounds',
          },
          {
            source: 'citation:9dd91be6311081c6ba54bcaca991bfd2ccce7878384751fd4d8106285bd82955',
            target: 'rule:seller_delivery',
            relation: 'grounds',
          },
          {
            source: 'citation:a1b22b98b9179cd7326af4d155c405c06798fdf9f690c0890219b32c07fdfbd1',
            target: 'rule:buyer_nonreceipt',
            relation: 'grounds',
          },
          {
            source: 'citation:b5ae82eab63ce777cdd9215a2e84e3d485f3a48d7ce438b1419865fddc290206',
            target: 'rule:contest_action',
            relation: 'grounds',
          },
          {
            source: 'literal:-decision_accept_claim',
            target: 'rule:contest_action',
            relation: 'premise',
          },
          {
            source: 'literal:claim_nonreceipt',
            target: 'rule:buyer_nonreceipt',
            relation: 'premise',
          },
          {
            source: 'literal:delivery_verified',
            target: 'rule:seller_delivery',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:invalid_tracking',
            relation: 'premise',
          },
          {
            source: 'literal:tracking_invalid',
            target: 'rule:seller_delivery',
            relation: 'exception',
          },
          { source: 'priority:0', target: 'rule:invalid_tracking', relation: 'higher' },
          { source: 'priority:0', target: 'rule:seller_delivery', relation: 'lower' },
          { source: 'priority:1', target: 'rule:buyer_nonreceipt', relation: 'lower' },
          { source: 'priority:1', target: 'rule:seller_delivery', relation: 'higher' },
          {
            source: 'reasoning',
            target: 'model:m_c5d89818e444fb7a160f498c',
            relation: 'extension',
          },
          {
            source: 'rule:buyer_nonreceipt',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:contest_action',
            target: 'literal:decision_provide_evidence',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'literal:decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:invalid_tracking',
            target: 'rule:seller_delivery',
            relation: 'overrides',
          },
          {
            source: 'rule:seller_delivery',
            target: 'literal:-decision_accept_claim',
            relation: 'head',
          },
          {
            source: 'rule:seller_delivery',
            target: 'rule:buyer_nonreceipt',
            relation: 'overrides',
          },
        ],
      },
      diagnostics: [],
    },
    governance: {
      recommended_action: null,
      confidence: 0.0,
      requires_human: true,
      reasons: [
        'No unambiguous executable merchant action',
        'Some facts lack verified evidence provenance',
        'Operational confidence is below the automatic execution threshold',
        'Extraction warnings require human review',
        'Synthetic policy is limited to demo and dry-run execution',
      ],
      components: {
        extraction: 0.0,
        verified_provenance: 0.0,
        action_consensus: 0.0,
        complete_enumeration: 1.0,
      },
    },
    attempts: [
      {
        attempt: 0,
        status: 'unique',
        knowledge_base: {
          facts: [],
          rules: [
            {
              id: 'buyer_nonreceipt',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'claim_nonreceipt', negated: false }],
              unless: [],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'buyer_nonreceipt',
                  quote:
                    'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
                },
              ],
            },
            {
              id: 'seller_delivery',
              head: { name: 'decision_accept_claim', negated: true },
              body: [{ name: 'delivery_verified', negated: false }],
              unless: [{ name: 'tracking_invalid', negated: false }],
              kind: 'defeasible',
              citations: [
                {
                  clause_id: 'seller_delivery',
                  quote:
                    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
                },
              ],
            },
            {
              id: 'invalid_tracking',
              head: { name: 'decision_accept_claim', negated: false },
              body: [{ name: 'tracking_invalid', negated: false }],
              unless: [],
              kind: 'defeater',
              citations: [
                {
                  clause_id: 'invalid_tracking',
                  quote:
                    'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
                },
              ],
            },
            {
              id: 'contest_action',
              head: { name: 'decision_provide_evidence', negated: false },
              body: [{ name: 'decision_accept_claim', negated: true }],
              unless: [],
              kind: 'strict',
              citations: [
                {
                  clause_id: 'contest_action',
                  quote:
                    'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
                },
              ],
            },
          ],
          priorities: [
            {
              higher: 'seller_delivery',
              lower: 'buyer_nonreceipt',
              citations: [
                {
                  clause_id: 'delivery_priority',
                  quote:
                    'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
                },
              ],
            },
            {
              higher: 'invalid_tracking',
              lower: 'seller_delivery',
              citations: [
                {
                  clause_id: 'invalid_priority',
                  quote:
                    'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
                },
              ],
            },
          ],
          confidence: 0.0,
          warnings: [
            'Synthetic demonstration policy and deterministic extraction; not actual PayPal contractual rules.',
            'No verified supported FACT markers were supplied; no demo decision can be inferred.',
          ],
        },
        program_sha256: '43fb926024555cb3a0a6ae95c12516d118e8314c4e6ea09e1e099332c882f72c',
        diagnostics: [],
      },
    ],
    agents: ['stair', 'extractor', 'asp_compiler', 'clingo', 'governance'],
  },
};

export const DEMO_POLICY: PolicyDocument = {
  id: 'demo_policy',
  title: 'Synthetic DisputeFlow demonstration policy (not PayPal terms)',
  version: '2026-10-demo',
  source_url: 'urn:disputeflow:synthetic-demo:2026-10',
  synthetic: true,
  sections: [
    {
      id: 'demo_scope',
      title: 'Scope and synthetic policy disclosure',
      text: 'This document is a synthetic DisputeFlow demonstration policy. It is not a PayPal agreement, seller protection policy, buyer protection policy, or legal interpretation. Its invented rules demonstrate auditable non-monotonic reasoning only.',
      children: [],
      keywords: ['always'],
    },
    {
      id: 'nonreceipt',
      title: 'Nonreceipt demonstration',
      text: '',
      keywords: [
        'claim_nonreceipt',
        'delivery_verified',
        'tracking_invalid',
        'not_received',
        'nonreceipt',
      ],
      children: [
        {
          id: 'buyer_nonreceipt',
          title: 'Buyer nonreceipt recommendation',
          text: 'In this synthetic demo, a verified claim_nonreceipt fact normally supports decision_accept_claim. A stronger applicable contrary rule can defeat this recommendation.',
          children: [],
          keywords: ['claim_nonreceipt', 'not_received', 'nonreceipt'],
        },
        {
          id: 'seller_delivery',
          title: 'Verified delivery exception',
          text: 'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
          children: [],
          keywords: ['delivery_verified', 'claim_nonreceipt', 'not_received', 'nonreceipt'],
        },
        {
          id: 'invalid_tracking',
          title: 'Invalid tracking defeater',
          text: 'In this synthetic demo, established tracking_invalid is a defeater protecting decision_accept_claim from contrary delivery-based rules. This exception alone does not establish decision_accept_claim.',
          children: [],
          keywords: ['tracking_invalid', 'claim_nonreceipt', 'not_received', 'nonreceipt'],
        },
        {
          id: 'priorities',
          title: 'Applicable nonreceipt rule priorities',
          text: '',
          keywords: [
            'claim_nonreceipt',
            'delivery_verified',
            'tracking_invalid',
            'not_received',
            'nonreceipt',
          ],
          children: [
            {
              id: 'delivery_priority',
              title: 'Delivery rule overrides nonreceipt rule',
              text: 'In this synthetic demo, seller_delivery has higher priority than buyer_nonreceipt. This priority only matters when both rules are applicable and their conclusions conflict.',
              children: [],
              keywords: ['always'],
            },
            {
              id: 'invalid_priority',
              title: 'Invalid tracking defeater overrides delivery rule',
              text: 'In this synthetic demo, the invalid_tracking defeater has higher priority than seller_delivery.',
              children: [],
              keywords: ['always'],
            },
          ],
        },
      ],
    },
    {
      id: 'quality',
      title: 'Competing quality evidence demonstration',
      text: '',
      keywords: ['quality_complaint', 'seller_inspection', 'not_as_described'],
      children: [
        {
          id: 'buyer_quality',
          title: 'Buyer quality complaint',
          text: 'In this synthetic demo, a verified quality_complaint fact normally supports decision_accept_claim.',
          children: [],
          keywords: ['quality_complaint', 'seller_inspection', 'not_as_described'],
        },
        {
          id: 'seller_quality',
          title: 'Competing seller inspection',
          text: 'In this synthetic demo, a verified seller_inspection fact normally supports the explicit opposite of decision_accept_claim. No priority between buyer_quality and seller_quality is specified; competing extensions require governance.',
          children: [],
          keywords: ['quality_complaint', 'seller_inspection', 'not_as_described'],
        },
      ],
    },
    {
      id: 'contest_action',
      title: 'Merchant evidence submission mapping',
      text: 'In this synthetic demo, the explicit opposite of decision_accept_claim strictly implies decision_provide_evidence. The merchant can submit evidence to PayPal; this does not adjudicate the dispute or deny a buyer claim.',
      children: [],
      keywords: ['always'],
    },
  ],
};

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function appendAudit(
  item: WorkspaceCase,
  kind: string,
  data: Record<string, unknown>,
  actor = 'demo_operator',
  timestamp = new Date().toISOString(),
): Promise<void> {
  const body: Omit<AuditEvent, 'hash'> = {
    case_id: item.id,
    sequence: item.audit.events.length + 1,
    kind,
    actor,
    data,
    timestamp,
    previous_hash: item.audit.head,
  };
  const hash = await sha256(canonical(body));
  item.audit.events.push({ ...body, hash });
  item.audit.head = hash;
  item.audit.verified = true;
}
export async function verifyDemoAudit(item: WorkspaceCase): Promise<boolean> {
  let previous = '0'.repeat(64);
  for (const [index, event] of item.audit.events.entries()) {
    const { hash, ...body } = event;
    if (
      event.sequence !== index + 1 ||
      event.previous_hash !== previous ||
      (await sha256(canonical(body))) !== hash
    )
      return false;
    previous = hash;
  }
  return item.audit.head === previous;
}

function evidence(
  id: string,
  content: string,
  atom: string,
  kind = 'statement',
  verified = true,
): Evidence {
  return {
    id,
    kind,
    content: `${content} Synthetic demonstration record. FACT:${atom}`,
    verified,
    source: 'synthetic_fixture',
  };
}
export const DEMO_CORRECTION: Evidence = evidence(
  'carrier_correction',
  'Carrier correction: the delivery scan belongs to a different consignment. The earlier tracking record is invalid.',
  'tracking_invalid',
  'tracking',
);
const buyer = () =>
  evidence('buyer_statement', 'Buyer reports that the order has not arrived.', 'claim_nonreceipt');
const carrier = (verified = true) =>
  evidence(
    'carrier_record',
    'Carrier delivery scan confirms delivery to the order address.',
    'delivery_verified',
    'tracking',
    verified,
  );
const quality = () =>
  evidence(
    'buyer_quality_report',
    'Buyer inspection documents a material difference from the listing.',
    'quality_complaint',
  );
const inspection = () =>
  evidence(
    'seller_inspection_report',
    'Merchant inspection documents compliance with the original specification.',
    'seller_inspection',
  );

/** Replay matching recorded fixtures, preserving real solver output and citations. */
export function replayDemoAnalysis(input: CaseInput): AnalysisResult {
  const grouped = new Map<string, string[]>();
  const warnings: string[] = [];
  const supported = new Set([
    'claim_nonreceipt',
    'delivery_verified',
    'tracking_invalid',
    'quality_complaint',
    'seller_inspection',
  ]);
  for (const item of input.evidence) {
    if (!item.verified) {
      warnings.push(`Unverified evidence ${item.id} was not promoted to a demo fact.`);
      continue;
    }
    for (const match of item.content.matchAll(/FACT:\s*(-?[a-z][a-z0-9_]*)/g)) {
      if (!supported.has(match[1].replace(/^-/, ''))) {
        warnings.push(`Unsupported demo atom in evidence ${item.id} was ignored.`);
        continue;
      }
      const references = grouped.get(match[1]) ?? [];
      if (!references.includes(item.id)) references.push(item.id);
      grouped.set(match[1], references);
    }
  }
  const signature = [...grouped.keys()].sort().join('|');
  const template = input.policy_id === 'demo_policy' ? TEMPLATES[signature] : undefined;
  if (!template) {
    const base = clone(TEMPLATES['']);
    base.retrieval = {
      policy_id: input.policy_id,
      policy_version: 'unavailable_offline',
      synthetic: true,
      clauses: [],
      trace: [{ status: 'offline_fixture_unavailable' }],
    };
    base.solver = null;
    base.knowledge_base = null;
    base.attempts = [];
    base.agents = ['offline_fixture_replay', 'governance'];
    base.governance = {
      recommended_action: null,
      confidence: 0,
      requires_human: true,
      reasons: [
        'This evidence combination has no recorded offline solver fixture. Connect the API to analyze custom cases.',
        ...warnings,
      ],
      components: {},
    };
    return base;
  }
  const result = clone(template);
  const knowledge = result.knowledge_base;
  const remapFacts = (
    facts: { literal: { name: string; negated: boolean }; evidence_ids: string[] }[],
  ) => {
    for (const fact of facts)
      fact.evidence_ids = [
        ...(grouped.get(`${fact.literal.negated ? '-' : ''}${fact.literal.name}`) ?? []),
      ];
  };
  if (knowledge) {
    remapFacts(knowledge.facts);
    knowledge.warnings = [
      ...knowledge.warnings.filter((w) => !w.startsWith('Unverified evidence')),
      ...warnings,
    ];
    for (const attempt of result.attempts) {
      const kb = attempt.knowledge_base as typeof knowledge | undefined;
      if (kb) remapFacts(kb.facts);
    }
    if (result.solver) {
      const proof = result.solver.proof;
      proof.nodes = proof.nodes.filter((node) => node.kind !== 'evidence');
      proof.edges = proof.edges.filter((edge) => !edge.source.startsWith('evidence:'));
      for (const fact of knowledge.facts) {
        const factNode = proof.nodes.find((node) => node.id === `fact:${fact.id}`);
        if (factNode) factNode.data = clone(fact) as unknown as Record<string, unknown>;
        for (const evidenceId of fact.evidence_ids) {
          const nodeId = `evidence:${evidenceId}`;
          if (!proof.nodes.some((node) => node.id === nodeId))
            proof.nodes.push({
              id: nodeId,
              kind: 'evidence',
              label: evidenceId,
              data: { evidence_id: evidenceId },
            });
          proof.edges.push({ source: nodeId, target: `fact:${fact.id}`, relation: 'supports' });
        }
      }
    }
  }
  result.governance.reasons = result.governance.reasons.filter(
    (reason) => !reason.startsWith('Amount or currency'),
  );
  if (Number(input.amount) > 100 || input.currency !== 'USD')
    result.governance.reasons.push(
      'Amount or currency is outside the configured automatic execution limit',
    );
  if (
    result.governance.recommended_action &&
    !input.allowed_actions.includes(result.governance.recommended_action)
  )
    result.governance.reasons.push('Action is not currently allowed for this dispute');
  result.governance.requires_human = true;
  return result;
}

export function demoMetrics(cases: WorkspaceCase[]): Metrics {
  const metrics: Metrics = { cases: {}, runs: {}, executions: {}, webhooks: {} };
  for (const item of cases) {
    metrics.cases[item.status] = (metrics.cases[item.status] ?? 0) + 1;
    if (item.latest_run)
      metrics.runs[item.latest_run.status] = (metrics.runs[item.latest_run.status] ?? 0) + 1;
    if (item.execution)
      metrics.executions[item.execution.status] =
        (metrics.executions[item.execution.status] ?? 0) + 1;
  }
  return metrics;
}

export function newDemoCase(
  input: CaseInput,
  index: number,
  display: Partial<WorkspaceCase['display']> = {},
): WorkspaceCase {
  const timestamp = new Date().toISOString();
  const id = `demo_case_${index}_${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    external_id: input.external_id,
    origin: 'synthetic_demo',
    data: clone(input),
    version: 1,
    status: 'open',
    latest_run_id: null,
    latest_run: null,
    created_at: timestamp,
    updated_at: timestamp,
    display: {
      customer: 'Demo customer',
      email: 'customer@example.test',
      initials: 'DC',
      product: 'Demo order',
      orderId: `DEMO-ORDER-${index}`,
      category: input.reason === 'not_as_described' ? 'Not as described' : 'Item not received',
      channel: 'Offline demo',
      dueAt: null,
      scenario: 'Custom synthetic case',
      ...display,
    },
    audit: { events: [], head: '0'.repeat(64), verified: true },
    review: null,
    execution: null,
  };
}

export async function createDemoPolicies(): Promise<WorkspacePolicy[]> {
  return [
    {
      ...clone(DEMO_POLICY),
      sha256: await sha256(canonical(DEMO_POLICY)),
      document: clone(DEMO_POLICY),
    },
  ];
}

export async function createDemoCases(): Promise<WorkspaceCase[]> {
  const seeds: {
    name: string;
    email: string;
    product: string;
    amount: string;
    reason: string;
    evidence: Evidence[];
    status: string;
    scenario: string;
    action?: Action;
    previousAction?: Action;
  }[] = [
    {
      name: 'Camille Laurent',
      email: 'camille.laurent@example.test',
      product: 'Orbit turntable · Graphite',
      amount: '249.00',
      reason: 'not_received',
      evidence: [buyer(), carrier()],
      status: 'review_required',
      scenario: 'Verified delivery overrides the nonreceipt default.',
    },
    {
      name: 'James Carter',
      email: 'james.carter@example.test',
      product: 'Forma desk lamp · Ivory',
      amount: '189.00',
      reason: 'not_as_described',
      evidence: [quality(), inspection()],
      status: 'review_required',
      scenario: 'Competing quality evidence produces two stable models.',
    },
    {
      name: 'Sofia Moreau',
      email: 'sofia.moreau@example.test',
      product: 'Arc headphones · Sand',
      amount: '129.00',
      reason: 'not_received',
      evidence: [buyer(), carrier(), clone(DEMO_CORRECTION)],
      status: 'review_required',
      scenario: 'New tracking correction retracts the earlier evidence submission recommendation.',
      previousAction: 'provide_evidence',
    },
    {
      name: 'Oliver Bennett',
      email: 'oliver.bennett@example.test',
      product: 'Field backpack · Olive',
      amount: '179.00',
      reason: 'not_received',
      evidence: [
        buyer(),
        carrier(),
        evidence(
          'carrier_negative',
          'Carrier correction explicitly states the order was not delivered.',
          '-delivery_verified',
          'tracking',
        ),
      ],
      status: 'review_required',
      scenario: 'Contradictory verified delivery records have no stable model.',
    },
    {
      name: 'Léa Dubois',
      email: 'lea.dubois@example.test',
      product: 'Nest ceramic set · Chalk',
      amount: '79.00',
      reason: 'not_received',
      evidence: [buyer()],
      status: 'reviewed',
      scenario: 'Buyer statement has no contrary verified delivery evidence.',
      action: 'accept_claim',
    },
    {
      name: 'Daniel Foster',
      email: 'daniel.foster@example.test',
      product: 'Canvas weekend bag · Ink',
      amount: '149.00',
      reason: 'not_received',
      evidence: [buyer(), carrier()],
      status: 'executed',
      scenario: 'Reviewed evidence response recorded in the demo dry-run journal.',
      action: 'provide_evidence',
    },
    {
      name: 'Emma Wilson',
      email: 'emma.wilson@example.test',
      product: 'Loop wireless charger · Pearl',
      amount: '89.00',
      reason: 'not_received',
      evidence: [buyer(), carrier(false)],
      status: 'open',
      scenario: 'Unverified carrier evidence must be reviewed before it becomes a fact.',
    },
    {
      name: 'Noah Martin',
      email: 'noah.martin@example.test',
      product: 'Studio notebook set · Natural',
      amount: '49.00',
      reason: 'not_as_described',
      evidence: [quality()],
      status: 'held',
      scenario: 'Operator chose to hold while requesting product photographs.',
      action: 'no_action',
    },
    {
      name: 'Amelia Brooks',
      email: 'amelia.brooks@example.test',
      product: 'Mono speaker · Stone',
      amount: '349.00',
      reason: 'not_received',
      evidence: [buyer(), carrier()],
      status: 'review_required',
      scenario: 'Verified delivery exception on an order above the demo execution threshold.',
    },
    {
      name: 'Lucas Bernard',
      email: 'lucas.bernard@example.test',
      product: 'Drift linen throw · Oat',
      amount: '119.00',
      reason: 'not_received',
      evidence: [
        evidence(
          'buyer_statement',
          'New buyer statement awaiting operator verification.',
          'claim_nonreceipt',
          'statement',
          false,
        ),
      ],
      status: 'open',
      scenario: 'New case awaiting evidence verification and first analysis.',
    },
  ];
  const cases: WorkspaceCase[] = [];
  for (const [index, seed] of seeds.entries()) {
    const created = new Date(Date.UTC(2026, 9, 6, 7, 48 - index * 17)).toISOString();
    const analyzed = new Date(new Date(created).getTime() + 120000).toISOString();
    const id = `demo_case_${String(index + 1).padStart(3, '0')}`;
    const externalId = `DEMO-DF-${1042 - index}`;
    const input: CaseInput = {
      external_id: externalId,
      reason: seed.reason,
      amount: seed.amount,
      currency: 'USD',
      summary: `Synthetic case: ${seed.scenario} All customer, order, and evidence information is fictional.`,
      evidence: seed.evidence,
      policy_id: 'demo_policy',
      auto_execute: false,
      allowed_actions: ['accept_claim', 'provide_evidence'],
    };
    const item: WorkspaceCase = {
      id,
      external_id: externalId,
      origin: 'synthetic_demo',
      data: input,
      version: seed.previousAction ? 2 : 1,
      status: seed.status,
      latest_run_id: null,
      latest_run: null,
      created_at: created,
      updated_at: analyzed,
      display: {
        customer: seed.name,
        email: seed.email,
        initials: seed.name
          .split(' ')
          .map((s) => s[0])
          .join(''),
        product: seed.product,
        orderId: `DEMO-ORD-${4829 - index * 13}`,
        category: seed.reason === 'not_as_described' ? 'Not as described' : 'Item not received',
        channel: 'Offline demo',
        dueAt:
          seed.status === 'executed' || seed.status === 'held'
            ? null
            : new Date(Date.UTC(2026, 9, 7 + (index % 4), 16)).toISOString(),
        scenario: seed.scenario,
        ...(seed.previousAction ? { previousAction: seed.previousAction } : {}),
      },
      audit: { events: [], head: '0'.repeat(64), verified: true },
      review: null,
      execution: null,
    };
    await appendAudit(
      item,
      'case_created',
      { external_id: externalId, version: 1, synthetic: true },
      'synthetic_fixture',
      created,
    );
    if (seed.previousAction) {
      await appendAudit(
        item,
        'analysis_completed',
        { action: seed.previousAction, case_version: 1, fixture_replay: true },
        'offline_fixture_replay',
        new Date(new Date(created).getTime() + 30000).toISOString(),
      );
      await appendAudit(
        item,
        'evidence_updated',
        { version: 2, evidence_ids: ['carrier_correction'], synthetic: true },
        'demo_operator',
        new Date(new Date(created).getTime() + 60000).toISOString(),
      );
    }
    if (seed.status !== 'open') {
      const result = replayDemoAnalysis(input);
      const runId = `demo_run_${index + 1}_v${item.version}`;
      item.latest_run_id = runId;
      item.latest_run = {
        id: runId,
        case_id: id,
        case_version: item.version,
        input_snapshot: clone(input),
        status: 'completed',
        execute_requested: false,
        result,
        error: null,
        created_at: new Date(new Date(analyzed).getTime() - 1800).toISOString(),
        finished_at: analyzed,
      };
      await appendAudit(
        item,
        'analysis_completed',
        {
          run_id: runId,
          case_version: item.version,
          solver_status: result.solver?.status,
          recommended_action: result.governance.recommended_action,
          program_sha256: result.solver?.program_sha256,
          fixture_replay: true,
        },
        'offline_fixture_replay',
        analyzed,
      );
      if (seed.action) {
        item.review = {
          id: `demo_review_${index + 1}`,
          run_id: runId,
          action: seed.action,
          note:
            seed.action === 'no_action'
              ? 'Hold the case until additional product photographs have been verified.'
              : 'Reviewed the synthetic policy citations and verified evidence. Approved for a demo response.',
          actor: 'demo_operator',
          created_at: new Date(new Date(analyzed).getTime() + 60000).toISOString(),
        };
        await appendAudit(
          item,
          'human_review',
          { run_id: runId, action: seed.action, note: item.review.note },
          'demo_operator',
          item.review.created_at,
        );
      }
      if (seed.status === 'executed' && seed.action) {
        const payload = {
          note: 'Reviewed synthetic delivery evidence. Offline demonstration only.',
        };
        const executed = new Date(new Date(analyzed).getTime() + 90000).toISOString();
        item.execution = {
          id: 'demo_execution_6',
          run_id: runId,
          idempotency_key: `demo:${runId}`,
          request_hash: await sha256(canonical(payload)),
          mode: 'dry_run',
          action: seed.action,
          payload,
          status: 'succeeded',
          response: { dry_run: true, synthetic: true, external_request_sent: false },
          error: null,
          created_at: executed,
          finished_at: executed,
        };
        await appendAudit(
          item,
          'execution_succeeded',
          {
            run_id: runId,
            execution_id: item.execution.id,
            mode: 'dry_run',
            external_request_sent: false,
          },
          'demo_operator',
          executed,
        );
      }
    }
    cases.push(item);
  }
  return cases;
}
