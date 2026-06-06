/**
 * Travel Insured International (TII) contact and routing constants.
 *
 * These values are sourced directly from the Confirmation of Benefits and
 * FlexiPAX Plan Document. The guardrail layer uses them to escalate urgent or
 * uncertain questions to the correct channel instead of guessing.
 */

export const TII_CONTACTS = {
  /** General plan & claims questions (weekdays 8:00 AM – 6:00 PM ET). */
  planAndClaims: {
    phone: "1-800-243-3174",
    hours: "Weekdays 8:00 AM – 6:00 PM ET",
    website: "https://www.travelinsured.com",
    mailingAddress: "Travel Insured International, P.O. Box 6503, Glastonbury, CT 06033-6503",
  },
  /** 24/7 non-insurance travel assistance & emergency services. */
  emergencyAssistance: {
    tollFreeUsCanada: "1-800-494-9907",
    collect: "1-603-328-1707",
    availability: "24/7",
  },
  /** Servicing / change requests line shown on the Confirmation of Benefits. */
  servicing: {
    phone: "1-855-752-8303",
    fax: "1-860-528-8005",
  },
} as const;

export const UNDERWRITER = "United States Fire Insurance Company";
export const ADMINISTRATOR = "Travel Insured International";

/** Canonical source labels used to tag every chunk in the knowledge base. */
export const SOURCE = {
  CONFIRMATION_OF_BENEFITS: "confirmation_of_benefits",
  PLAN_DOCUMENT: "plan_document",
} as const;

export type SourceTag = (typeof SOURCE)[keyof typeof SOURCE];

export const SOURCE_LABELS: Record<SourceTag, string> = {
  [SOURCE.CONFIRMATION_OF_BENEFITS]: "Confirmation of Benefits",
  [SOURCE.PLAN_DOCUMENT]: "FlexiPAX Plan Document",
};
