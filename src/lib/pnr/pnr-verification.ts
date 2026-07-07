/**
 * Self-contained PNR (booking confirmation number) verification for the FNOL
 * flow's PNR step.
 *
 * Imports nothing from the rest of the codebase by design — the rest of the
 * FNOL flow depends only on the {@link PnrVerificationResult} shape, so the
 * data source can be swapped here without touching the handler or the route.
 * See the PNR investigation doc for why this has to be our own booking
 * record rather than a live airline/GDS lookup.
 */

export interface PnrVerificationResult {
  verified: boolean;
  reason?: 'not_found' | 'mismatch';
}

/**
 * DEMO OVERRIDE — remove once a real sales/purchase pipeline populates this
 * table. Mock bookings tied to the demo flights. In production this becomes a
 * lookup against the insurer's own booking/policy records (Supabase table),
 * populated when the policy is purchased — see the PNR investigation doc for
 * why no airline/GDS API can do this lookup for an arbitrary real booking.
 */
const DEMO_BOOKINGS: Record<string, { pnr: string; lastName: string }> = {
  SWA566: { pnr: 'ABC123', lastName: 'Lopez' },
  SWA565: { pnr: 'XYZ789', lastName: 'Lopez' },
};

export function verifyBooking(
  flightNumber: string,
  pnr: string,
): PnrVerificationResult {
  const booking = DEMO_BOOKINGS[flightNumber.trim().toUpperCase()];
  if (!booking) return { verified: false, reason: 'not_found' };
  const pnrMatch = booking.pnr.toUpperCase() === pnr.trim().toUpperCase();
  if (!pnrMatch) return { verified: false, reason: 'mismatch' };
  return { verified: true };
}

/**
 * Reverse lookup: given a PNR, return the flight number whose booking it belongs
 * to (or null if no booking has that PNR). Used when a traveler supplies a PNR
 * after the flow has drifted out of the PNR-confirmation step ("back to the
 * first one, here is my pnr ABC123") so the PNR can be re-attached to the flight
 * it actually belongs to. Finding a flight here does NOT by itself approve a
 * claim — the caller must still confirm that flight's qualifying delay.
 */
export function findBookingFlightByPnr(pnr: string): string | null {
  const target = pnr.trim().toUpperCase();
  for (const [flightNumber, booking] of Object.entries(DEMO_BOOKINGS)) {
    if (booking.pnr.toUpperCase() === target) return flightNumber;
  }
  return null;
}
