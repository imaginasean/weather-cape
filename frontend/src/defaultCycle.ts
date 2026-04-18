export type SynopticHour = '00' | '12'

/**
 * Most recent synoptic cycle (00Z or 12Z) that should already be
 * published on Wyoming's archive, allowing ~4h of upload lag.
 */
export function latestPublishedCycle(now: Date = new Date()): { dateIso: string; hourZ: SynopticHour } {
  const lagged = new Date(now.getTime() - 4 * 3600 * 1000)
  const h = lagged.getUTCHours()
  const hh: SynopticHour = h < 12 ? '00' : '12'
  const dateIso = lagged.toISOString().slice(0, 10)
  return { dateIso, hourZ: hh }
}
