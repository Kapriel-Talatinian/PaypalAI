import type { CaseView, WorkspaceCase } from '../types';

export function normalizeCase(item: CaseView, previous?: WorkspaceCase): WorkspaceCase {
  const reason = item.data.reason.replaceAll('_', ' ');
  const provider = item.origin === 'paypal' ? item.data.paypal : null;
  const transactions = provider?.transactions ?? [];
  const buyer = transactions.find((transaction) => transaction.buyer)?.buyer;
  const product = transactions
    .flatMap((transaction) => transaction.items ?? [])
    .find((product) => product.item_name)?.item_name;
  const reference = transactions
    .map(
      (transaction) =>
        transaction.invoice_number ??
        transaction.reference_id ??
        transaction.seller_transaction_id ??
        transaction.buyer_transaction_id,
    )
    .find(Boolean);
  const customer = buyer?.name ?? buyer?.email ?? 'Customer not supplied';
  const initials = buyer?.name
    ? buyer.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((name) => name[0])
        .join('')
        .toUpperCase()
    : buyer?.email
      ? buyer.email.slice(0, 2).toUpperCase()
      : '?';
  const display =
    item.origin === 'paypal'
      ? {
          customer,
          email: buyer?.email ?? 'Not supplied by PayPal',
          initials,
          product: product ?? 'Item not supplied by PayPal',
          orderId: reference ?? 'Not supplied by PayPal',
          category: reason.charAt(0).toUpperCase() + reason.slice(1),
          channel: 'PayPal',
          dueAt: provider?.seller_response_due_date ?? null,
          scenario: item.data.summary,
        }
      : (previous?.display ?? {
          customer: 'Customer not supplied',
          email: 'Not supplied by the API',
          initials: '?',
          product: 'Manual dispute',
          orderId: 'Not supplied',
          category: reason.charAt(0).toUpperCase() + reason.slice(1),
          channel: 'Manual import',
          dueAt: null,
          scenario: item.data.summary,
        });
  return {
    ...item,
    latest_run: item.latest_run ?? null,
    display,
    audit: previous?.audit ?? { events: [], head: '0'.repeat(64), verified: false },
    review: item.latest_run_id === previous?.latest_run_id ? (previous?.review ?? null) : null,
    execution:
      item.latest_run_id === previous?.latest_run_id ? (previous?.execution ?? null) : null,
  };
}

export function caseOpenedAt(item: WorkspaceCase): string {
  return item.origin === 'paypal'
    ? (item.data.paypal?.create_time ?? item.created_at)
    : item.created_at;
}
