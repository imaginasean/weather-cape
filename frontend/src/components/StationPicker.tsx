import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchStationAvailability } from '../api'
import { UPPER_AIR_STATIONS, normalizeStationId, type UpperAirStation } from '../data/stations'
import { latestPublishedCycle } from '../defaultCycle'
import { buildWyomingCsvUrl } from '../wyomingCsvUrl'

const HOURS_Z = ['00', '03', '06', '09', '12', '15', '18', '21'] as const

const defaultCycle = latestPublishedCycle()

type Props = {
  onLoad: (url: string) => void
  loading: boolean
}

export function StationPicker({ onLoad, loading }: Props) {
  const [wmo, setWmo] = useState('72426')
  const [date, setDate] = useState<string>(defaultCycle.dateIso)
  const [hourZ, setHourZ] = useState<(typeof HOURS_Z)[number]>(defaultCycle.hourZ)
  const [filter, setFilter] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [available, setAvailable] = useState<Set<string>>(new Set())
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(() => {
      void (async () => {
        const set = await fetchStationAvailability(date, hourZ)
        setAvailable(set)
      })()
    }, 400)
    return () => {
      if (debRef.current) clearTimeout(debRef.current)
    }
  }, [date, hourZ])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return UPPER_AIR_STATIONS.slice(0, 60)
    return UPPER_AIR_STATIONS.filter((s) => {
      const id = normalizeStationId(s.wmo)
      return (
        id.includes(q) ||
        s.wmo.includes(q) ||
        (s.icao && s.icao.toLowerCase().includes(q)) ||
        s.name.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q)
      )
    }).slice(0, 80)
  }, [filter])

  const pickStation = useCallback((s: UpperAirStation) => {
    setWmo(normalizeStationId(s.wmo))
    setFilter('')
    setListOpen(false)
  }, [])

  const hasAvail = available.size > 0
  const availNorm = useMemo(() => {
    const s = new Set<string>()
    for (const k of available) {
      s.add(k)
      if (/^\d+$/.test(String(k))) s.add(normalizeStationId(String(k)))
    }
    return s
  }, [available])

  const rowUnknown = (s: UpperAirStation) => {
    if (!hasAvail) return false
    return !availNorm.has(normalizeStationId(s.wmo))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onLoad(buildWyomingCsvUrl(wmo, date, hourZ))
    setListOpen(false)
  }

  return (
    <form className="stationPicker" onSubmit={submit}>
      <div className="stationPickerRow">
        <label className="stationPickerLabel">
          <span>Station</span>
          <div className="stationCombo">
            <input
              className="stationComboInput"
              value={listOpen ? filter : normalizeStationId(wmo)}
              onChange={(e) => {
                const v = e.target.value
                setFilter(v)
                setListOpen(true)
                const digits = v.replace(/\D/g, '').slice(0, 6)
                if (digits.length >= 3) setWmo(normalizeStationId(digits))
              }}
              onFocus={() => {
                setListOpen(true)
                setFilter(normalizeStationId(wmo))
              }}
              onBlur={() => {
                setTimeout(() => setListOpen(false), 180)
              }}
              placeholder="WMO / ICAO / name"
              spellCheck={false}
              aria-autocomplete="list"
              aria-expanded={listOpen}
            />
            {listOpen && (
              <ul className="stationComboList" role="listbox">
                {filtered.map((s) => (
                  <li key={s.wmo + s.name}>
                    <button
                      type="button"
                      className={`stationComboItem${rowUnknown(s) ? ' maybeMissing' : ''}`}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => pickStation(s)}
                    >
                      <span className="stationComboId">{normalizeStationId(s.wmo)}</span>
                      {s.icao && <span className="stationComboIcao">{s.icao}</span>}
                      <span className="stationComboName">{s.name}</span>
                      {rowUnknown(s) && <span className="stationComboHint">no index</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
        <label className="stationPickerLabel">
          <span>Date (UTC)</span>
          <input className="stationDateInput" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="stationPickerLabel">
          <span>Hour (Z)</span>
          <select
            className="stationHourSelect"
            value={hourZ}
            onChange={(e) => setHourZ(e.target.value as (typeof HOURS_Z)[number])}
          >
            {HOURS_Z.map((h) => (
              <option key={h} value={h}>
                {h}Z
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn primary stationLoadBtn" disabled={loading}>
          {loading ? '…' : 'Load'}
        </button>
      </div>
      {!hasAvail && (
        <p className="stationPickerNote">Station availability index unavailable — all sites shown.</p>
      )}
    </form>
  )
}
