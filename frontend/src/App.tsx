import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { analyzeSoundingUrl } from './api'
import { Resizer } from './components/Resizer'
import { SoundingChat } from './components/SoundingChat'
import { SoundingScene } from './components/SoundingScene'
import { StationPicker } from './components/StationPicker'
import { latestPublishedCycle } from './defaultCycle'
import {
  animationTopPressure,
  heightAtProgress,
  heightForPressureMb,
  nearestIndexForHeight,
  surfaceHeight,
} from './soundingMath'
import type { ParcelId, SoundingAnalysis } from './types'
import { buildWyomingCsvUrl } from './wyomingCsvUrl'

import './App.css'

const CHAT_WIDTH_LS = 'weather-cape.chatWidth'
const CHAT_MIN = 48
const CHAT_DEFAULT = 340

function defaultSoundingUrl(): string {
  const { dateIso, hourZ } = latestPublishedCycle()
  return buildWyomingCsvUrl('72426', dateIso, hourZ)
}

const PARCEL_LABELS: Record<ParcelId, { short: string; full: string }> = {
  sb: { short: 'Surface', full: 'Surface-based parcel' },
  ml: { short: 'Mixed layer', full: 'Mixed-layer parcel (lowest 100 mb)' },
  mu: { short: 'Most unstable', full: 'Most-unstable parcel' },
}

function readChatWidth(): number {
  const n = Number(localStorage.getItem(CHAT_WIDTH_LS))
  if (Number.isFinite(n) && n >= CHAT_MIN) return Math.round(n)
  return CHAT_DEFAULT
}

function smoothstep01(u: number): number {
  return u * u * (3 - 2 * u)
}

function inverseSmoothstep01(target: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5
    if (smoothstep01(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) * 0.5
}

function progressForHeight(z: number, z0: number, z1: number): number {
  const range = z1 - z0
  if (Math.abs(range) < 1e-6) return 0
  const linear = (z - z0) / range
  const clamped = Math.max(0, Math.min(1, linear))
  return inverseSmoothstep01(clamped)
}

function metDirectionFromUV(uMs: number, vMs: number): number {
  const towardDeg = (Math.atan2(uMs, vMs) * 180) / Math.PI
  return (towardDeg + 180 + 360) % 360
}

function App() {
  const [url, setUrl] = useState(defaultSoundingUrl)
  const [data, setData] = useState<SoundingAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [parcelId, setParcelId] = useState<ParcelId>('ml')
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showInversionsOnly, setShowInversionsOnly] = useState(false)
  const [chatWidthPx, setChatWidthPx] = useState(readChatWidth)
  const lastExpandedRef = useRef(CHAT_DEFAULT)

  const load = useCallback(
    async (overrideUrl?: string) => {
      const target = overrideUrl ?? url
      if (overrideUrl != null) setUrl(overrideUrl)
      setLoading(true)
      setErr(null)
      try {
        const res = await analyzeSoundingUrl(target)
        setData(res)
        setProgress(0)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [url],
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    localStorage.setItem(CHAT_WIDTH_LS, String(chatWidthPx))
  }, [chatWidthPx])

  useEffect(() => {
    if (chatWidthPx >= 200) lastExpandedRef.current = chatWidthPx
  }, [chatWidthPx])

  const onResizerDrag = useCallback((dx: number) => {
    setChatWidthPx((w) => {
      const maxW = Math.min(720, Math.floor(window.innerWidth * 0.55))
      const n = Math.round(w - dx)
      return Math.max(CHAT_MIN, Math.min(maxW, n))
    })
  }, [])

  const chatCollapsed = chatWidthPx < 72

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setProgress((p) => {
        let speed = 0.08
        if (data) {
          const deltas = data.delta_t_c[parcelId]
          const parcel = data.parcels[parcelId]
          const z0 = surfaceHeight(data.levels)
          if (z0 != null && deltas?.length) {
            const topP = animationTopPressure(parcel, data.levels)
            const z1 = heightForPressureMb(topP, data.levels)
            if (z1 != null) {
              const z = heightAtProgress(p, z0, z1)
              const idx = nearestIndexForHeight(z, data.levels)
              const deltaT = deltas[idx] ?? 0
              const speedFactor =
                deltaT >= 0 ? 1 + Math.min(6, deltaT / 1.8) : Math.max(0.12, 1 + deltaT / 3)
              speed = 0.045 * speedFactor
            }
          }
        }
        const n = p + dt * speed
        return n >= 1 ? 0 : n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, data, parcelId])

  const meta = data?.meta as
    | {
        station_name?: string
        station_code?: string
        utc_hour?: number
        utc_day?: number
        utc_month_name?: string
        utc_year?: number
        temperature_input_unit?: string
        temperature_output_unit?: string
        converted_from_kelvin?: boolean
      }
    | undefined

  const parcel = data?.parcels[parcelId]
  const currentSample = useMemo(() => {
    if (!data || !parcel) return null
    const levels = data.levels
    const deltas = data.delta_t_c[parcelId]
    const z0 = surfaceHeight(levels)
    if (z0 == null || !deltas?.length) return null
    const topP = animationTopPressure(parcel, levels)
    const z1 = heightForPressureMb(topP, levels)
    if (z1 == null) return null
    const z = heightAtProgress(progress, z0, z1)
    const idx = nearestIndexForHeight(z, levels)
    const lv = levels[idx]
    return {
      idx,
      zM: z,
      pMb: lv?.p_mb ?? null,
      tC: lv?.t_c ?? null,
      tdC: lv?.td_c ?? null,
      rhPct: lv?.rh_pct ?? null,
      uMs: lv?.u_ms ?? null,
      vMs: lv?.v_ms ?? null,
      deltaT: deltas[idx] ?? null,
      z0,
      z1,
    }
  }, [data, parcel, parcelId, progress])
  const currentDeltaT = currentSample?.deltaT ?? null
  const currentWind = useMemo(() => {
    if (!currentSample || currentSample.uMs == null || currentSample.vMs == null) return null
    const speedMs = Math.hypot(currentSample.uMs, currentSample.vMs)
    const speedMph = speedMs * 2.23694
    const dirDeg = metDirectionFromUV(currentSample.uMs, currentSample.vMs)
    return { speedMph, dirDeg }
  }, [currentSample])

  const inversionTargets = useMemo(() => {
    if (!data || !parcel || !data.layers?.cap_layers?.length || !currentSample) return []
    const { z0, z1 } = currentSample
    return data.layers.cap_layers
      .map((band, i) => {
        const zBottom = heightForPressureMb(Math.max(band.bottom_mb, band.top_mb), data.levels)
        const zTop = heightForPressureMb(Math.min(band.bottom_mb, band.top_mb), data.levels)
        if (zBottom == null || zTop == null) return null
        const zCenter = (zBottom + zTop) * 0.5
        return {
          id: i,
          bottomMb: Math.max(band.bottom_mb, band.top_mb),
          topMb: Math.min(band.bottom_mb, band.top_mb),
          centerFt: Math.round(zCenter * 3.28084),
          targetProgress: progressForHeight(zCenter, z0, z1),
        }
      })
      .filter(
        (x): x is { id: number; bottomMb: number; topMb: number; centerFt: number; targetProgress: number } =>
          x != null,
      )
  }, [data, parcel, currentSample])

  const tempUnitText = meta
    ? meta.converted_from_kelvin
      ? 'Input temp: K -> normalized to C'
      : 'Input temp: C'
    : null

  return (
    <div className="app">
      <header className="appChrome">
        <div className="brand">
          <span className="logo">Weather Cape</span>
          <span className="tag">parcel ascent · real soundings</span>
        </div>
        <StationPicker onLoad={(u) => void load(u)} loading={loading} />
      </header>

      <div className="mainRow">
        <aside className="sidebar">
          <div className="transport">
            <button type="button" className="btn" onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <label className="scrub">
              <span className="sr-only">Ascent progress</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={progress}
                onChange={(e) => {
                  setProgress(Number(e.target.value))
                  setPlaying(false)
                }}
              />
            </label>
          </div>

          {currentSample && (
            <div className="panelCard panelCardDense">
              <div className="panelTitle">Current position</div>
              <div className="dataGrid dataGridDense twoUp">
                <span>Height</span>
                <strong>{Math.round(currentSample.zM * 3.28084).toLocaleString()} ft</strong>
                <span>Pressure</span>
                <strong>{currentSample.pMb != null ? `${Math.round(currentSample.pMb)} mb` : '—'}</strong>
                <span>Temperature</span>
                <strong>{currentSample.tC != null ? `${currentSample.tC.toFixed(1)} °C` : '—'}</strong>
                <span>Dewpoint</span>
                <strong>{currentSample.tdC != null ? `${currentSample.tdC.toFixed(1)} °C` : '—'}</strong>
                <span>Humidity</span>
                <strong>{currentSample.rhPct != null ? `${Math.round(currentSample.rhPct)}%` : '—'}</strong>
                <span>Buoyancy</span>
                <strong>
                  {currentSample.deltaT != null
                    ? `${currentSample.deltaT > 0 ? '+' : ''}${currentSample.deltaT.toFixed(1)} °C`
                    : '—'}
                </strong>
              </div>
            </div>
          )}

          {currentWind && (
            <div className="panelCard panelCardDense">
              <div className="panelTitle">Anemometer</div>
              <div className="anemometerWrap anemometerWrapDense">
                <div
                  className="anemometerCups anemometerCupsDense"
                  style={
                    {
                      '--spin-dur': `${Math.max(0.7, 7 - Math.min(6, currentWind.speedMph * 0.2))}s`,
                    } as CSSProperties
                  }
                  aria-hidden
                >
                  <span className="cup c1" />
                  <span className="cup c2" />
                  <span className="cup c3" />
                  <span className="hub" />
                </div>
                <div className="windCompass windCompassDense">
                  <div className="compassRing" />
                  <div className="compassLabels">
                    <span>N</span>
                    <span>E</span>
                    <span>S</span>
                    <span>W</span>
                  </div>
                  <div
                    className="windVane"
                    style={{ transform: `translate(-50%, -50%) rotate(${currentWind.dirDeg}deg)` }}
                  />
                </div>
              </div>
              <div className="anemoReadout">
                <span>Wind from {Math.round(currentWind.dirDeg)}°</span>
                <span>{currentWind.speedMph.toFixed(1)} mph</span>
              </div>
            </div>
          )}

          {inversionTargets.length > 0 && (
            <div className="panelCard panelCardDense">
              <div className="panelTitle">Inversion layers</div>
              <div className="invList invListDense">
                {inversionTargets.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    className="invItem"
                    title="Jump the ascent to this inversion"
                    onClick={() => {
                      setProgress(inv.targetProgress)
                      setPlaying(false)
                      setShowInversionsOnly(true)
                    }}
                  >
                    <span>Layer {inv.id + 1}</span>
                    <span>
                      {inv.bottomMb.toFixed(0)}–{inv.topMb.toFixed(0)} mb · {inv.centerFt.toLocaleString()} ft
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {err && <div className="banner error bannerCompact">{err}</div>}

          <div className="metaLine metaLineDense">
            {meta && (
              <>
                <strong>
                  {meta.station_name} ({meta.station_code})
                </strong>
                <span>
                  {meta.utc_hour}Z {meta.utc_day} {meta.utc_month_name} {meta.utc_year}
                </span>
                {tempUnitText && <span>{tempUnitText}</span>}
              </>
            )}
          </div>

          <div className="parcelToggle" role="group" aria-label="Parcel type">
            {(['sb', 'ml', 'mu'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={parcelId === id ? 'btn toggle active' : 'btn toggle'}
                title={PARCEL_LABELS[id].full}
                onClick={() => setParcelId(id)}
              >
                {PARCEL_LABELS[id].short}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={showInversionsOnly ? 'btn toggle active' : 'btn toggle'}
            onClick={() => setShowInversionsOnly((v) => !v)}
          >
            {showInversionsOnly ? 'Show full profile' : 'Highlight inversions'}
          </button>

          {parcel && (
            <div className="stats statsDense statGrid">
              <div className="statCell" title="Convective Available Potential Energy">
                <em>CAPE</em>
                <strong>{parcel.cape_jkg != null ? `${Math.round(parcel.cape_jkg)} J/kg` : '—'}</strong>
              </div>
              <div className="statCell" title="Convective Inhibition">
                <em>CIN</em>
                <strong>{parcel.cin_jkg != null ? `${Math.round(parcel.cin_jkg)} J/kg` : '—'}</strong>
              </div>
              <div className="statCell" title="Lifted Condensation Level (cloud base)">
                <em>Cloud base</em>
                <strong>{parcel.lcl_mb != null ? `${Math.round(parcel.lcl_mb)} mb` : '—'}</strong>
              </div>
              <div className="statCell" title="Level of Free Convection">
                <em>Free convection</em>
                <strong>{parcel.lfc_mb != null ? `${Math.round(parcel.lfc_mb)} mb` : '—'}</strong>
              </div>
              <div className="statCell" title="Equilibrium Level (storm top)">
                <em>Storm top</em>
                <strong>{parcel.el_mb != null ? `${Math.round(parcel.el_mb)} mb` : '—'}</strong>
              </div>
              <div className="statCell" title="Parcel buoyancy at current height">
                <em>Buoyancy</em>
                <strong>
                  {currentDeltaT != null
                    ? `${currentDeltaT > 0 ? '+' : ''}${currentDeltaT.toFixed(1)} °C ${
                        currentDeltaT > 0 ? '(unstable)' : '(stable)'
                      }`
                    : '—'}
                </strong>
              </div>
            </div>
          )}

          <div className="legend legendDense">
            <span className="legend-item stable">Cooler than parcel</span>
            <span className="legend-item neutral">Neutral</span>
            <span className="legend-item unstable">Warmer than parcel</span>
            <span className="legend-item inversion">Inversion cap</span>
            <span className="legend-item">Wind barbs: north is up, staff points upwind</span>
          </div>
          <div className="dt-scale dt-scaleDense" aria-label="Buoyancy color scale">
            <span className="dt-scale-label">−8 °C</span>
            <div className="dt-scale-bar dt-scale-barShort" />
            <span className="dt-scale-label">0</span>
            <div className="dt-scale-bar dt-scale-bar-half dt-scale-barShort" />
            <span className="dt-scale-label">+8 °C</span>
          </div>
        </aside>

        <section className="stage">
          {data && (
            <SoundingScene
              data={data}
              parcelId={parcelId}
              progress={progress}
              playing={playing}
              showInversionsOnly={showInversionsOnly}
            />
          )}
          {!data && !err && <div className="placeholder">{loading ? 'Fetching sounding…' : 'No data'}</div>}
        </section>

        <Resizer onDrag={onResizerDrag} />


        <div className="chatWrap" style={{ flex: `0 0 ${chatWidthPx}px`, width: chatWidthPx, minWidth: 0 }}>
          <SoundingChat
            meta={meta ?? null}
            sounding={data}
            collapsed={chatCollapsed}
            onExpand={() => setChatWidthPx(lastExpandedRef.current)}
          />
        </div>
      </div>
    </div>
  )
}

export default App
