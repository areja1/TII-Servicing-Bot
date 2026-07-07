/**
 * Self-contained flight-status lookup for the Flight Delay FNOL proof-of-concept.
 *
 * Uses the AviationStack REST API (https://aviationstack.com). The free tier
 * authenticates with an `access_key` query parameter (not a header) and is
 * served over plain HTTP. Delay values come back in MINUTES, so the 6-hour
 * FlexiPAX Trip Delay trigger is a direct `delay >= 360` comparison.
 *
 * Imports nothing from the rest of the codebase by design — the rest of the
 * FNOL flow depends only on the {@link FlightStatusResult} shape, so the data
 * provider can be swapped here without touching the handler or the route.
 */

export interface FlightStatusResult {
  flightNumber: string;
  found: boolean;
  isDelayed: boolean;
  delayMinutes: number | null;
  status: string | null;
  raw: unknown;
}

/** Minimum qualifying delay (minutes) for a FlexiPAX Trip Delay claim (6 hours). */
const DELAY_THRESHOLD_MINUTES = 360;

/**
 * DEMO OVERRIDE — remove after the client demo.
 *
 * AviationStack's free tier rarely has a flight delayed 6+ hours on demand
 * (and doesn't carry Southwest `SWA…` idents at all), so the "claim approved"
 * path can't be triggered reliably live. These two scripted idents guarantee
 * the demo: SWA566 returns a qualifying 6h+ delay (approval path) and SWA565
 * returns an on-time flight (declined path). EVERY other ident falls through
 * to the real AviationStack lookup below.
 */
const DEMO_FLIGHTS: Record<string, { isDelayed: boolean; delayMinutes: number; status: string }> = {
  SWA566: { isDelayed: true, delayMinutes: 412, status: "active" },
  SWA565: { isDelayed: false, delayMinutes: 0, status: "active" },
};

/** Free-tier AviationStack endpoint (HTTP only on the free plan). */
const AVIATIONSTACK_FLIGHTS_URL = "http://api.aviationstack.com/v1/flights";

/** Minimal shape of the AviationStack /v1/flights response we rely on. */
interface AviationStackLeg {
  delay: number | null;
}
interface AviationStackFlight {
  flight_status: string | null;
  departure: AviationStackLeg | null;
  arrival: AviationStackLeg | null;
}
interface AviationStackResponse {
  data?: AviationStackFlight[];
  error?: { code?: string; message?: string };
}

/** The "could not resolve this flight" result, sans the echoed flight number. */
const NOT_FOUND = {
  found: false,
  isDelayed: false,
  delayMinutes: null,
  status: null,
  raw: null,
} as const;

export async function checkFlightStatus(
  flightNumber: string,
): Promise<FlightStatusResult> {
  // DEMO OVERRIDE — remove after the client demo. Scripted idents short-circuit
  // before any network call; all other idents use the live API below.
  const demo = DEMO_FLIGHTS[flightNumber.trim().toUpperCase()];
  if (demo) {
    return {
      flightNumber,
      found: true,
      isDelayed: demo.isDelayed,
      delayMinutes: demo.delayMinutes,
      status: demo.status,
      raw: { demo: true },
    };
  }

  try {
    const accessKey = process.env.AVIATIONSTACK_API_KEY ?? "";
    const ident = flightNumber.trim().toUpperCase();

    // AviationStack distinguishes ICAO idents (3-letter prefix, e.g. SWA566)
    // from IATA idents (2-letter prefix, e.g. WN566). Query the matching field.
    const prefix = ident.match(/^[A-Z]+/)?.[0] ?? "";
    const identField = prefix.length >= 3 ? "flight_icao" : "flight_iata";

    // No flight_date: the free tier can't reliably resolve historical/future
    // dates, so we query by ident alone and take the most recent match.
    const url =
      `${AVIATIONSTACK_FLIGHTS_URL}?access_key=${encodeURIComponent(accessKey)}` +
      `&${identField}=${encodeURIComponent(ident)}`;

    const response = await fetch(url);

    if (response.status === 404) {
      return { flightNumber, ...NOT_FOUND };
    }
    if (!response.ok) {
      return { flightNumber, ...NOT_FOUND, status: "error" };
    }

    const json = (await response.json()) as AviationStackResponse;

    // The free tier returns HTTP 200 with an `error` object for bad keys,
    // quota exhaustion, etc. Treat that as an error, not a missing flight.
    if (json.error) {
      return { flightNumber, ...NOT_FOUND, status: "error" };
    }

    const flights = json.data ?? [];
    if (flights.length === 0) {
      return { flightNumber, ...NOT_FOUND };
    }

    // Most recent matching flight is first.
    const first = flights[0];
    const departureDelay = first.departure?.delay ?? null;
    const arrivalDelay = first.arrival?.delay ?? null;
    const isDelayed =
      (arrivalDelay !== null && arrivalDelay >= DELAY_THRESHOLD_MINUTES) ||
      (departureDelay !== null && departureDelay >= DELAY_THRESHOLD_MINUTES);

    return {
      flightNumber,
      found: true,
      isDelayed,
      delayMinutes: arrivalDelay ?? departureDelay ?? null,
      status: first.flight_status ?? null,
      raw: json,
    };
  } catch {
    return {
      flightNumber,
      found: false,
      isDelayed: false,
      delayMinutes: null,
      status: "error",
      raw: null,
    };
  }
}
