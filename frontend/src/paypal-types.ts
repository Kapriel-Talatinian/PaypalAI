// Matches the serialized PayPal metadata contracts in src/disputeflow/domain.py.
// Provider observations retain unknown values; they do not attest their truth.
export interface PayPalDelivery {
  source_path: string;
  item_id: string | null;
  description: string | null;
  product_received: string | null;
  product_received_time: string | null;
  expected_delivery_date: string | null;
  return_time: string | null;
  return_mode: string | null;
  return_receipt: boolean | null;
  returned: boolean | null;
  return_confirmation_number: string | null;
}
export interface PayPalDocument {
  name: string | null;
  url: string | null;
}
export interface PayPalEvidence {
  evidence_type: string | null;
  source: string | null;
  date: string | null;
  notes: string | null;
  item_id: string | null;
  item_type: string | null;
  dispute_life_cycle_stage: string | null;
  action_info: PayPalEvidenceRequirement | null;
  tracking_info: Array<PayPalTracking>;
  refund_ids: Array<string>;
  documents: Array<PayPalDocument>;
}
export interface PayPalEvidenceRequirement {
  evidence_type: string | null;
  action: string | null;
  response_option: string | null;
  mandatory: boolean | null;
}
export interface PayPalItem {
  item_id: string | null;
  item_name: string | null;
  item_description: string | null;
  item_quantity: number | null;
  item_type: string | null;
  reason: string | null;
  dispute_amount: PayPalMoney | null;
  partner_transaction_id: string | null;
  notes: string | null;
}
export interface PayPalLink {
  href: string;
  rel: string;
  method: string | null;
}
export interface PayPalMoney {
  value: string;
  currency_code: string;
}
export interface PayPalMoneyMovement {
  affected_party: string | null;
  amount: PayPalMoney | null;
  initiated_time: string | null;
  type: string | null;
  reason: string | null;
}
export interface PayPalParty {
  name: string | null;
  email: string | null;
  merchant_id: string | null;
}
export interface PayPalRefundDetails {
  allowed_refund_amount: PayPalMoney | null;
  amount_refunded: PayPalMoney | null;
  outcome_code: string | null;
}
export interface PayPalResponseOptions {
  accept_claim_types: Array<string>;
  offer_types: Array<string>;
  acknowledgement_types: Array<string>;
}
export interface PayPalReturnAddress {
  address_line_1: string | null;
  address_line_2: string | null;
  address_line_3: string | null;
  admin_area_1: string | null;
  admin_area_2: string | null;
  admin_area_3: string | null;
  admin_area_4: string | null;
  postal_code: string | null;
  country_code: string | null;
}
export interface PayPalSupportingInfo {
  notes: string | null;
  source: string | null;
  provided_time: string | null;
  dispute_life_cycle_stage: string | null;
  documents: Array<PayPalDocument>;
}
export interface PayPalTracking {
  carrier_name: string | null;
  carrier_name_other: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
}
export interface PayPalTransaction {
  seller_transaction_id: string | null;
  buyer_transaction_id: string | null;
  reference_id: string | null;
  create_time: string | null;
  transaction_status: string | null;
  gross_amount: PayPalMoney | null;
  invoice_number: string | null;
  custom: string | null;
  buyer: PayPalParty | null;
  seller: PayPalParty | null;
  items: Array<PayPalItem>;
}
export interface PayPalDisputeMetadata {
  dispute_id: string;
  reason: string;
  status: string | null;
  dispute_state: string | null;
  dispute_life_cycle_stage: string | null;
  dispute_channel: string | null;
  create_time: string | null;
  update_time: string | null;
  seller_response_due_date: string | null;
  buyer_response_due_date: string | null;
  transactions: Array<PayPalTransaction>;
  existing_evidence: Array<PayPalEvidence>;
  requested_evidence: Array<PayPalEvidenceRequirement>;
  supporting_info: Array<PayPalSupportingInfo>;
  tracking_info: Array<PayPalTracking>;
  refund_ids: Array<string>;
  delivery_details: Array<PayPalDelivery>;
  return_shipping_address: PayPalReturnAddress | null;
  refund_details: PayPalRefundDetails | null;
  money_movements: Array<PayPalMoneyMovement>;
  allowed_response_options: PayPalResponseOptions;
  links: Array<PayPalLink>;
  normalization_warnings: Array<string>;
}
