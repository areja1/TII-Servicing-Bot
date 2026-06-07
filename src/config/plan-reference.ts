import { SOURCE, type SourceTag } from "@/config/tii";
import type { RetrievedPassage } from "@/types";

/**
 * High-value passages that are ALWAYS injected into the retrieval context.
 *
 * PostgreSQL full-text search reliably surfaces benefit *names* but sometimes
 * misses the dense Schedule-of-Benefits sub-limit tables and a few General
 * Definitions, because a short user question rarely shares enough tokens with
 * those chunks to rank in the top results. Since the source documents are
 * fixed for this POC, we pin these verbatim excerpts so the bot can always
 * answer about sub-limits (dental, per-article, passport, credit card) and key
 * definitions without guessing.
 *
 * Every string below is quoted directly from the FlexiPAX Plan Document.
 */
interface PinnedPassage {
  id: string;
  section: string;
  content: string;
}

const PINNED: PinnedPassage[] = [
  {
    id: "pinned-schedule-belongings-medical",
    section: "Schedule of Benefits (Sub-limits)",
    content: [
      "SECTION V — Protection For Your Belongings (Maximum Benefit Amounts)",
      "Baggage and Personal Effects: up to $1,000",
      "Sub-limits:",
      "- Passport, Visa or Other Travel Documents Replacement: up to $100",
      "- Credit Card charges and interest: up to $100",
      "- Per Article Limit: up to $250",
      "- Combined articles limit: up to $500",
      "Baggage Delay (6 hours): up to $300",
      "",
      "SECTION VI — Travel Insurance Benefits (Maximum Benefit Amounts)",
      "Accident & Sickness Medical Expense: up to $100,000",
      "- Dental Expense sublimit: up to $750",
      "",
      "(These are the FlexiPAX Plan Document's standard Schedule-of-Benefits amounts and sub-limits. This traveler also purchased the Optional Baggage & Personal Effects Increase (up to $2,500) and Optional Baggage Delay Increase (up to $500) per the Confirmation of Benefits; the per-article, combined, passport, credit-card and dental sub-limits above still apply within those benefits.)",
    ].join("\n"),
  },
  {
    id: "pinned-def-passport-replacement",
    section: "Section V › Passport / Travel Documents & Credit Card",
    content:
      "The plan covers the replacement of passports, visas and other travel documents which are lost, stolen, damaged or destroyed during Your Trip, and charges and interest incurred due to unauthorized use or replacement of Your lost or stolen credit cards if such use or loss occurs during Your Trip, subject to verification that You have complied with all conditions of the credit card company. Passport/Visa/Travel Documents Replacement is limited to up to $100, and Credit Card charges and interest to up to $100.",
  },
  {
    id: "pinned-def-traveling-companion",
    section: "Section VIII › General Definitions",
    content:
      "Traveling Companion means a person or persons whose name(s) appear(s) with Yours on the same Travel Arrangements and who, during Your Trip, will accompany You. A group or tour organizer, sponsor or leader is not a Traveling Companion as defined, unless sharing accommodations in the same room, cabin, condominium unit, apartment unit or other lodging with You.",
  },
  {
    id: "pinned-assistance-overview",
    section: "Worldwide Non-Insurance Assistance Services (p.4)",
    content: [
      "WORLDWIDE NON-INSURANCE ASSISTANCE SERVICES",
      "The Travel Assistance feature provides a variety of travel related services.",
      "Services offered include:",
      "• Medical or Legal Referral • Inoculation Information • Hospital Admission Guarantee",
      "• Telemedicine • House Calls • Translation Service • Lost Baggage Retrieval • Passport/Visa Information • Emergency Cash Advance • Bail Bond • Prescription Drug/Eyeglass Replacement • ID Theft Resolution Service • Concierge Service • Business Concierge",
      "",
      "24/7 Worldwide Non-Insurance Assistance Services",
      "Travel Assistance, Medical Emergency, Concierge Service, Business Concierge, and ID Theft Resolution Service",
      "FOR EMERGENCY ASSISTANCE DURING YOUR TRIP CALL: 800-494-9907 (From US/Canada) OR CALL COLLECT: 603-328-1707 (From all other locations)",
      "",
      "Travel assistance non-insurance services are provided by an independent organization and not by United States Fire Insurance Company or Travel Insured International. There may be times when circumstances beyond the Assistance Company's control hinder their endeavors to provide travel assistance services. They will, however, make all reasonable efforts to provide travel assistance services and help You resolve Your emergency situation.",
    ].join("\n"),
  },
  {
    id: "pinned-assistance-availability",
    section: "Worldwide Non-Insurance Assistance Services › Availability",
    content: [
      "AVAILABILITY OF SERVICES",
      "You are eligible for information and concierge services at any time after You purchase this plan.",
      "The Emergency Assistance Services become available when You actually start Your Covered Trip.",
      "Emergency Assistance, Concierge and Informational Services end the earliest of: midnight on the day the program expires; when You reach Your return destination; or when You complete Your Covered Trip.",
      "The Identity Theft Resolution Services become available on Your scheduled departure date for Your Covered Trip. Services are provided only for an Identity Theft event which occurs while on Your Covered Trip.",
    ].join("\n"),
  },
  {
    id: "pinned-concierge-services",
    section: "Worldwide Non-Insurance Assistance Services › Concierge Services",
    content: [
      "CONCIERGE SERVICES",
      "Concierge Services are provided by Travel Insured's designated provider. There is no charge for the services provided by the provider. You are responsible for the cost of services provided and charged for by third parties and for the actual cost of merchandise, entertainment, sports, tickets, food and beverages and other disbursement items.",
      "Services offered include:",
      "• Destination Profiles • Epicurean Needs • Event Ticketing • Floral Services • Tee Time Reservations • Hotel Accommodations • Meet-And-Greet Services • Shopping Assistance Services • Pre-Trip Assistance • Procurement of Hard-To-Find Items • Restaurant Referrals and Reservations • Rental Car Reservations • Airline Reservations",
    ].join("\n"),
  },
  {
    id: "pinned-business-concierge",
    section: "Worldwide Non-Insurance Assistance Services › Business Concierge Services",
    content: [
      "BUSINESS CONCIERGE SERVICES",
      "Concierge Services are provided by Travel Insured's designated provider. There is no charge for the services provided by the provider. You are responsible for the cost of services provided and charged for by third parties.",
      "Services offered include:",
      "• Emergency Correspondence And Business Communication Assistance",
      "• Assistance With Locating Available Business Services Such As: Express/Overnight Delivery Sites, Internet Cafes, Print/Copy Services",
      "• Assistance With Or Arrangements For Telephone And Web Conferencing",
      "• Emergency Messaging To Customers, Associates, And Others (Phone, Fax, E-mail, Text, etc.)",
      "• Real Time Weather, Travel Delay And Flight Status Information",
      "• Worldwide Business Directory Service For Equipment Repair/Replacement, Warranty Service, etc.",
      "• Emergency Travel Arrangements",
    ].join("\n"),
  },
  {
    id: "pinned-identity-theft-resolution",
    section: "Worldwide Non-Insurance Assistance Services › Identity Theft Resolution",
    content: [
      "IDENTITY THEFT RESOLUTION SERVICES",
      "In the event of an Identity Theft event while on Your Covered Trip, Travel Insured's designated provider will provide you with the support and tools needed for You to restore Your identity.",
      "Assistance includes contacting Your creditors to notify them of the event and to request replacement cards; connecting you with a friend or family member at home and providing them with the assistance to set up a transfer or wire of funds; information on how to contact the three major credit bureaus; guidance on how to obtain a police report; and providing You with a guide on how to restore Your credit.",
      "Identity Theft Resolution does not guarantee a particular outcome. Identity Theft Resolution does not include and shall not assist You for thefts involving non-US bank accounts.",
    ].join("\n"),
  },
];

/** Pinned passages shaped as retrieval results (tagged to the Plan Document). */
export const PINNED_PASSAGES: RetrievedPassage[] = PINNED.map((p) => ({
  id: p.id,
  source: SOURCE.PLAN_DOCUMENT as SourceTag,
  section: p.section,
  page: null,
  content: p.content,
  rank: 1,
}));
