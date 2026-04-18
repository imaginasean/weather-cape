import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import { analyzeSoundingUrl } from './api'
import { SoundingChat } from './components/SoundingChat'
import { SoundingScene } from './components/SoundingScene'
import {
	animationTopPressure,
	heightAtProgress,
	heightForPressureMb,
	nearestIndexForHeight,
	surfaceHeight,
} from './soundingMath'
import type { ParcelId, SoundingAnalysis } from './types'

import './App.css'

const DEMO_URL =
	'https://weather.uwyo.edu/wsgi/sounding?datetime=2026-04-18%2012:00:00&id=72426&src=BUFR&type=TEXT:CSV'

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
	const [url, setUrl] = useState(DEMO_URL)
	const [data, setData] = useState<SoundingAnalysis | null>(null)
	const [loading, setLoading] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	const [parcelId, setParcelId] = useState<ParcelId>('ml')
	const [progress, setProgress] = useState(0)
	const [playing, setPlaying] = useState(false)
	const [showInversionsOnly, setShowInversionsOnly] = useState(false)
	const [showAiChat, setShowAiChat] = useState(false)

	const load = useCallback(async () => {
		setLoading(true)
		setErr(null)
		try {
			const res = await analyzeSoundingUrl(url)
			setData(res)
			setProgress(0)
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e))
			setData(null)
		} finally {
			setLoading(false)
		}
	}, [url])

	useEffect(() => {
		void load()
		// Initial demo load only; further loads use the form.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

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
								deltaT >= 0
									? 1 + Math.min(6, deltaT / 1.8)
									: Math.max(0.12, 1 + deltaT / 3)
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
		if (
			!currentSample ||
			currentSample.uMs == null ||
			currentSample.vMs == null
		)
			return null
		const speedMs = Math.hypot(currentSample.uMs, currentSample.vMs)
		const speedMph = speedMs * 2.23694
		const dirDeg = metDirectionFromUV(currentSample.uMs, currentSample.vMs)
		return { speedMph, dirDeg }
	}, [currentSample])

	const inversionTargets = useMemo(() => {
		if (!data || !parcel || !data.layers?.cap_layers?.length || !currentSample)
			return []
		const { z0, z1 } = currentSample
		return data.layers.cap_layers
			.map((band, i) => {
				const zBottom = heightForPressureMb(
					Math.max(band.bottom_mb, band.top_mb),
					data.levels,
				)
				const zTop = heightForPressureMb(
					Math.min(band.bottom_mb, band.top_mb),
					data.levels,
				)
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
				(
					x,
				): x is {
					id: number
					bottomMb: number
					topMb: number
					centerFt: number
					targetProgress: number
				} => x != null,
			)
	}, [data, parcel, currentSample])

	const tempUnitText = meta
		? meta.converted_from_kelvin
			? 'Input temp: K -> normalized to C'
			: 'Input temp: C'
		: null

	return (
		<div className='app'>
			<div className='layout'>
				<aside className='sidebar'>
					<div className='brand'>
						<span className='logo'>Weather Cape</span>
						<span className='tag'>parcel ascent · real soundings</span>
					</div>

					<form
						className='urlRow'
						onSubmit={(e) => {
							e.preventDefault()
							void load()
						}}
					>
						<input
							className='urlInput'
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							spellCheck={false}
							aria-label='Wyoming sounding URL'
						/>
						<button type='submit' className='btn primary' disabled={loading}>
							{loading ? 'Loading…' : 'Load'}
						</button>
					</form>

					{err && <div className='banner error'>{err}</div>}

					<div className='metaLine'>
						{meta && (
							<>
								<strong>
									{meta.station_name} ({meta.station_code})
								</strong>
								<span>
									{meta.utc_hour}Z {meta.utc_day} {meta.utc_month_name}{' '}
									{meta.utc_year}
								</span>
								{tempUnitText && <span>{tempUnitText}</span>}
							</>
						)}
					</div>

					<div className='parcelToggle' role='group' aria-label='Parcel type'>
						{(['sb', 'ml', 'mu'] as const).map((id) => (
							<button
								key={id}
								type='button'
								className={parcelId === id ? 'btn toggle active' : 'btn toggle'}
								onClick={() => setParcelId(id)}
							>
								{id === 'sb'
									? 'Surface'
									: id === 'ml'
										? 'Mixed layer'
										: 'Most unstable'}
							</button>
						))}
					</div>

					<button
						type='button'
						className={showAiChat ? 'btn toggle active' : 'btn toggle'}
						disabled={!data}
						onClick={() => setShowAiChat((v) => !v)}
						title={
							data
								? 'Open chat to analyze the current 3D scene with a local vision model'
								: 'Load a sounding first'
						}
					>
						{showAiChat ? 'Close AI chat' : 'Analyze with AI'}
					</button>

					<button
						type='button'
						className={showInversionsOnly ? 'btn toggle active' : 'btn toggle'}
						onClick={() => setShowInversionsOnly((v) => !v)}
					>
						{showInversionsOnly
							? 'Showing only inversions'
							: 'Show only inversions'}
					</button>

					{currentSample && (
						<div className='panelCard'>
							<div className='panelTitle'>Current Position</div>
							<div className='dataGrid'>
								<span>Height</span>
								<strong>
									{Math.round(currentSample.zM * 3.28084).toLocaleString()} ft
								</strong>
								<span>Pressure</span>
								<strong>
									{currentSample.pMb != null
										? `${Math.round(currentSample.pMb)} mb`
										: '—'}
								</strong>
								<span>Temp</span>
								<strong>
									{currentSample.tC != null
										? `${currentSample.tC.toFixed(1)} C`
										: '—'}
								</strong>
								<span>Dewpoint</span>
								<strong>
									{currentSample.tdC != null
										? `${currentSample.tdC.toFixed(1)} C`
										: '—'}
								</strong>
								<span>RH</span>
								<strong>
									{currentSample.rhPct != null
										? `${Math.round(currentSample.rhPct)}%`
										: '—'}
								</strong>
								<span>dT</span>
								<strong>
									{currentSample.deltaT != null
										? `${currentSample.deltaT > 0 ? '+' : ''}${currentSample.deltaT.toFixed(1)} C`
										: '—'}
								</strong>
							</div>
						</div>
					)}

					{currentWind && (
						<div className='panelCard'>
							<div className='panelTitle'>Anemometer</div>
							<div className='anemometerWrap'>
								<div
									className='anemometerCups'
									style={
										{
											'--spin-dur': `${Math.max(0.7, 7 - Math.min(6, currentWind.speedMph * 0.2))}s`,
										} as CSSProperties
									}
									aria-hidden
								>
									<span className='cup c1' />
									<span className='cup c2' />
									<span className='cup c3' />
									<span className='hub' />
								</div>
								<div className='windCompass'>
									<div className='compassRing' />
									<div className='compassLabels'>
										<span>N</span>
										<span>E</span>
										<span>S</span>
										<span>W</span>
									</div>
									<div
										className='windVane'
										style={{
											transform: `translate(-50%, -50%) rotate(${currentWind.dirDeg}deg)`,
										}}
									/>
								</div>
							</div>
							<div className='anemoReadout'>
								<span>From {Math.round(currentWind.dirDeg)} deg</span>
								<span>{currentWind.speedMph.toFixed(1)} mph</span>
							</div>
						</div>
					)}

					{inversionTargets.length > 0 && (
						<div className='panelCard'>
							<div className='panelTitle'>Inversion Layers</div>
							<div className='invList'>
								{inversionTargets.map((inv) => (
									<button
										key={inv.id}
										type='button'
										className='invItem'
										onClick={() => {
											setProgress(inv.targetProgress)
											setPlaying(false)
											setShowInversionsOnly(true)
										}}
									>
										<span>Layer {inv.id + 1}</span>
										<span>
											{inv.bottomMb.toFixed(0)}-{inv.topMb.toFixed(0)} mb (
											{inv.centerFt.toLocaleString()} ft)
										</span>
									</button>
								))}
							</div>
						</div>
					)}

					{parcel && (
						<div className='stats'>
							<span>
								CAPE{' '}
								{parcel.cape_jkg != null ? Math.round(parcel.cape_jkg) : '—'}{' '}
								J/kg
							</span>
							<span>
								CIN {parcel.cin_jkg != null ? Math.round(parcel.cin_jkg) : '—'}{' '}
								J/kg
							</span>
							<span>
								LCL {parcel.lcl_mb != null ? Math.round(parcel.lcl_mb) : '—'} mb
							</span>
							<span>
								LFC {parcel.lfc_mb != null ? Math.round(parcel.lfc_mb) : '—'} mb
							</span>
							<span>
								EL {parcel.el_mb != null ? Math.round(parcel.el_mb) : '—'} mb
							</span>
							<span>
								dT{' '}
								{currentDeltaT != null
									? `${currentDeltaT > 0 ? '+' : ''}${currentDeltaT.toFixed(1)} C`
									: '—'}{' '}
								(
								{currentDeltaT == null
									? 'neutral'
									: currentDeltaT > 0
										? 'unstable'
										: 'stable'}
								)
							</span>
						</div>
					)}

					<div className='legend'>
						<span className='legend-item stable'>
							Negative dT (stable): blue
						</span>
						<span className='legend-item neutral'>Near-zero dT: white</span>
						<span className='legend-item unstable'>
							Positive dT (unstable): red
						</span>
						<span className='legend-item inversion'>
							Inversion layers: magenta highlighted bands
						</span>
						<span className='legend-item'>
							Speed follows dT (warmer parcel rises faster)
						</span>
						<span className='legend-item'>
							Wind barbs (left): fixed map card facing front (XY plane); east
							(u) right, north (v) up; staff points upwind (meteo convention)
						</span>
					</div>
					<div className='dt-scale' aria-label='dT color scale'>
						<span className='dt-scale-label'>-8 C</span>
						<div className='dt-scale-bar' />
						<span className='dt-scale-label'>0</span>
						<div className='dt-scale-bar dt-scale-bar-half' />
						<span className='dt-scale-label'>+8 C</span>
					</div>

					<div className='transport'>
						<button
							type='button'
							className='btn'
							onClick={() => setPlaying((p) => !p)}
						>
							{playing ? 'Pause' : 'Play'}
						</button>
						<label className='scrub'>
							<span className='sr-only'>Ascent progress</span>
							<input
								type='range'
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
				</aside>

				<section className='stage'>
					{data && (
						<SoundingScene
							data={data}
							parcelId={parcelId}
							progress={progress}
							playing={playing}
							showInversionsOnly={showInversionsOnly}
						/>
					)}
					{!data && !err && (
						<div className='placeholder'>
							{loading ? 'Fetching sounding…' : 'No data'}
						</div>
					)}
					<SoundingChat
						open={showAiChat}
						onClose={() => setShowAiChat(false)}
						meta={meta ?? null}
					/>
				</section>
			</div>
		</div>
	)
}

export default App
