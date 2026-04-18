import { normalizeStationId } from './data/stations'

export function buildWyomingCsvUrl(wmo: string, dateIso: string, hourZ: string): string {
  const hh = hourZ.padStart(2, '0')
  const dt = `${dateIso} ${hh}:00:00`
  return `https://weather.uwyo.edu/wsgi/sounding?datetime=${encodeURIComponent(dt)}&id=${normalizeStationId(wmo)}&src=BUFR&type=TEXT:CSV`
}
