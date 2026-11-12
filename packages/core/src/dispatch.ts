// Nearest-driver matching and batching. Pure functions over the travel_times matrix.
import { cashGate, type CashCap } from "./cash";

export type Matrix = (fromVillage: string, toVillage: string) => number | undefined; // minutes

export interface DriverState {
  driverId: string;
  village: string;              // last known position, snapped to a village
  positionAgeMin: number;       // how stale that position is
  cashUsd: number;
  openStops: string[];          // villages still to visit on the current run, in order
  loadedOrders: number;
  departed: boolean;            // has left the pickup point
}
export interface Job { orderId: string; pickupVillage: string; dropVillage: string; codUsd: number; readyInMin: number }
export interface Rules { cap: CashCap; maxOrders: number; maxDetourMin: number; stalePositionPenaltyMin: number }
export interface Candidate { driverId: string; etaToPickupMin: number; detourMin: number; batched: boolean; score: number }

function routeMinutes(stops: string[], m: Matrix): number {
  let total = 0;
  for (let i = 0; i + 1 < stops.length; i++) total += m(stops[i]!, stops[i + 1]!) ?? 999;
  return total;
}

export function rankDrivers(job: Job, drivers: DriverState[], m: Matrix, rules: Rules): Candidate[] {
  const out: Candidate[] = [];
  for (const d of drivers) {
    if (cashGate(d.cashUsd, job.codUsd, rules.cap) !== "ok") continue;
    if (d.loadedOrders >= rules.maxOrders) continue;
    if (d.departed && d.loadedOrders > 0) continue;                           // do not pull a loaded rider back uphill

    const before = routeMinutes([d.village, ...d.openStops], m);
    const withJob = d.loadedOrders === 0
      ? routeMinutes([d.village, job.pickupVillage, job.dropVillage], m)
      : routeMinutes([d.village, ...insertCheapest(d.openStops, job.dropVillage, m)], m);
    const detour = d.loadedOrders === 0 ? 0 : withJob - before;
    if (d.loadedOrders > 0 && detour > rules.maxDetourMin) continue;

    const etaToPickup = d.loadedOrders === 0 ? (m(d.village, job.pickupVillage) ?? 999) : 0;
    const wait = Math.max(0, job.readyInMin - etaToPickup);                    // idle time at the hub is wasted time
    const stale = d.positionAgeMin > 15 ? rules.stalePositionPenaltyMin : 0;
    out.push({ driverId: d.driverId, etaToPickupMin: etaToPickup, detourMin: detour, batched: d.loadedOrders > 0,
               score: etaToPickup + detour + wait * 0.5 + stale });
  }
  return out.sort((a, b) => a.score - b.score);
}

function insertCheapest(stops: string[], add: string, m: Matrix): string[] {
  let best = [...stops, add], bestCost = Infinity;
  for (let i = 0; i <= stops.length; i++) {
    const trial = [...stops.slice(0, i), add, ...stops.slice(i)];
    const cost = routeMinutes(trial, m);
    if (cost < bestCost) { best = trial; bestCost = cost; }
  }
  return best;
}

/** Blend a new observed trip time into the matrix: the mountain teaches the map. */
export function learnTravelTime(prevMin: number, prevSamples: number, observedMin: number): { minutes: number; samples: number } {
  const w = Math.min(prevSamples, 20);
  return { minutes: Math.round(((prevMin * w + observedMin) / (w + 1)) * 10) / 10, samples: prevSamples + 1 };
}
