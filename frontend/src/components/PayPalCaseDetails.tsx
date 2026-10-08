import type { WorkspaceCase } from '../types';
import type { PayPalMoney } from '../paypal-types';
import { ACTION_LABELS, date, money } from '../lib/format';
import './provider-record.css';

const label = (value: string | null | undefined) =>
  value
    ? value
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/^\w/, (letter) => letter.toUpperCase())
    : 'Not provided';
const amount = (value: PayPalMoney | null | undefined) =>
  value ? money(value.value, value.currency_code) : 'Not provided';
const timestamp = (value: string | null | undefined) =>
  value
    ? date(value, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not provided';

export default function PayPalCaseDetails({ item }: { item: WorkspaceCase }) {
  if (item.origin !== 'paypal') return null;
  const provider = item.data.paypal;
  if (!provider)
    return (
      <p className="provider-record-note">
        Structured PayPal details are unavailable. Refresh the import to load them.
      </p>
    );
  return (
    <section className="provider-record" aria-label="PayPal record">
      <h3>PayPal record</h3>
      <dl>
        <div>
          <dt>PayPal status</dt>
          <dd>{label(provider.status)}</dd>
        </div>
        <div>
          <dt>Lifecycle stage</dt>
          <dd>{label(provider.dispute_life_cycle_stage)}</dd>
        </div>
        <div>
          <dt>Expected response</dt>
          <dd>{label(provider.dispute_state)}</dd>
        </div>
        <div>
          <dt>Dispute channel</dt>
          <dd>{label(provider.dispute_channel)}</dd>
        </div>
        <div>
          <dt>Opened in PayPal</dt>
          <dd>{timestamp(provider.create_time)}</dd>
        </div>
        <div>
          <dt>Last PayPal update</dt>
          <dd>{timestamp(provider.update_time)}</dd>
        </div>
        <div>
          <dt>Seller response deadline</dt>
          <dd>{timestamp(provider.seller_response_due_date)}</dd>
        </div>
        <div>
          <dt>Buyer response deadline</dt>
          <dd>{timestamp(provider.buyer_response_due_date)}</dd>
        </div>
        <div>
          <dt>Permitted responses</dt>
          <dd>
            {item.data.allowed_actions.length
              ? item.data.allowed_actions.map((action) => ACTION_LABELS[action]).join(', ')
              : 'None advertised by PayPal'}
          </dd>
        </div>
        <div>
          <dt>Evidence requirements</dt>
          <dd>
            {provider.requested_evidence.length
              ? provider.requested_evidence
                  .map((requirement) =>
                    [
                      label(requirement.evidence_type),
                      requirement.action ? label(requirement.action) : null,
                      requirement.mandatory === true
                        ? 'Required'
                        : requirement.mandatory === false
                          ? 'Optional'
                          : 'Requirement unspecified',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  )
                  .join('; ')
              : 'Not provided by PayPal'}
          </dd>
        </div>
      </dl>
      <p className="provider-record-note">
        These are observations reported by PayPal. Statements and evidence still require
        verification.
      </p>
      {provider.transactions.length > 0 && (
        <details>
          <summary>Transactions and items ({provider.transactions.length})</summary>
          {provider.transactions.map((transaction, index) => (
            <article key={index}>
              <h4>
                Transaction{' '}
                {transaction.seller_transaction_id ?? transaction.buyer_transaction_id ?? index + 1}
              </h4>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{label(transaction.transaction_status)}</dd>
                </div>
                <div>
                  <dt>Gross amount</dt>
                  <dd>{amount(transaction.gross_amount)}</dd>
                </div>
                <div>
                  <dt>Invoice reference</dt>
                  <dd>{transaction.invoice_number ?? 'Not provided'}</dd>
                </div>
                <div>
                  <dt>Buyer</dt>
                  <dd>{transaction.buyer?.name ?? transaction.buyer?.email ?? 'Not provided'}</dd>
                </div>
              </dl>
              {transaction.items.length > 0 ? (
                <ul>
                  {transaction.items.map((product, itemIndex) => (
                    <li key={itemIndex}>
                      <strong>{product.item_name ?? 'Item name not provided'}</strong>
                      <p>{product.item_description ?? 'Description not provided'}</p>
                      <small>
                        Quantity: {product.item_quantity ?? 'Not provided'} · Disputed item amount:{' '}
                        {amount(product.dispute_amount)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Item details not provided.</p>
              )}
            </article>
          ))}
        </details>
      )}
      {provider.existing_evidence.length > 0 && (
        <details>
          <summary>Evidence reported by PayPal ({provider.existing_evidence.length})</summary>
          <ul>
            {provider.existing_evidence.map((evidence, index) => (
              <li key={index}>
                <strong>{label(evidence.evidence_type)}</strong>
                <p>{evidence.notes ?? 'No notes provided'}</p>
                <small>
                  Source: {label(evidence.source)} · {timestamp(evidence.date)}
                </small>
                {evidence.documents.length > 0 && (
                  <p>
                    Documents:{' '}
                    {evidence.documents
                      .map((document) => document.name ?? 'Unnamed document')
                      .join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(provider.tracking_info.length > 0 ||
        provider.refund_ids.length > 0 ||
        provider.refund_details ||
        provider.delivery_details.length > 0 ||
        provider.money_movements.length > 0) && (
        <details>
          <summary>Delivery and refunds</summary>
          <ul>
            {provider.tracking_info.map((tracking, index) => (
              <li key={`tracking-${index}`}>
                Tracking: {tracking.tracking_number ?? 'Not provided'} · Carrier:{' '}
                {tracking.carrier_name_other ?? tracking.carrier_name ?? 'Not provided'}
              </li>
            ))}
            {provider.delivery_details.map((delivery, index) => (
              <li key={`delivery-${index}`}>
                Reported receipt: {label(delivery.product_received)} ·{' '}
                {timestamp(delivery.product_received_time)}
                {delivery.description && <p>{delivery.description}</p>}
              </li>
            ))}
            {provider.refund_ids.map((id) => (
              <li key={id}>Refund reference: {id}</li>
            ))}
            {provider.refund_details && (
              <li>
                Reported refunded amount: {amount(provider.refund_details.amount_refunded)} ·
                Permitted refund amount: {amount(provider.refund_details.allowed_refund_amount)}
              </li>
            )}
            {provider.money_movements.map((movement, index) => (
              <li key={`movement-${index}`}>
                {label(movement.type)}: {amount(movement.amount)} · {label(movement.affected_party)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {provider.normalization_warnings.length > 0 && (
        <div className="provider-record-warning" role="status">
          <strong>Some PayPal fields could not be read</strong>
          <ul>
            {provider.normalization_warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          <p>The original source remains available in the PayPal case evidence.</p>
        </div>
      )}
    </section>
  );
}
