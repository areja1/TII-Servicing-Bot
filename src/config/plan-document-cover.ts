import { TII_CONTACTS, ADMINISTRATOR, UNDERWRITER } from "@/config/tii";

/**
 * FlexiPAX Plan Document page 1 (cover) text.
 *
 * pdf-parse cannot extract this page — the PDF cover is image-only with no text
 * layer. This supplement is inserted at ingest so page-1 queries and Supabase
 * page metadata stay complete. Contact numbers match the Confirmation of
 * Benefits and {@link TII_CONTACTS}.
 */
export const PLAN_DOCUMENT_PAGE_1_COVER = [
  "FlexiPAX",
  "Individual Travel Insurance Policy",
  "Plan Summary / Cover Page (Page 1)",
  "",
  `Underwriter: ${UNDERWRITER}`,
  `Administrator: ${ADMINISTRATOR}`,
  "",
  "For plan information and servicing:",
  "www.travelinsured.com",
  `Plan changes and servicing: ${TII_CONTACTS.servicing.phone}`,
  "",
  "24/7 Worldwide Emergency Assistance and Medical Evacuation:",
  `${TII_CONTACTS.emergencyAssistance.tollFreeUsCanada} (US/Canada toll-free)`,
  `${TII_CONTACTS.emergencyAssistance.collect} (collect from other locations)`,
  "Emergency medical evacuation must be pre-authorized.",
  "",
  "Plan and claims questions:",
  `${TII_CONTACTS.planAndClaims.phone} (${TII_CONTACTS.planAndClaims.hours})`,
  TII_CONTACTS.planAndClaims.mailingAddress,
].join("\n");
