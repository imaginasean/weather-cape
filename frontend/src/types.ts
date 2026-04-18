export type ParcelId = 'sb' | 'ml' | 'mu'

export interface SoundingLevel {
  p_mb: number
  z_m: number | null
  t_c: number
  td_c: number
  u_ms: number | null
  v_ms: number | null
  rh_pct: number | null
}

export interface ParcelData {
  id: string
  cape_jkg: number | null
  cin_jkg: number | null
  lcl_mb: number | null
  lfc_mb: number | null
  el_mb: number | null
  parcel_t_c: number[]
}

export interface LayerBand {
  bottom_mb: number
  top_mb: number
}

export interface SoundingAnalysis {
  source_url: string
  meta: Record<string, unknown>
  levels: SoundingLevel[]
  parcels: Record<ParcelId, ParcelData>
  delta_t_c: Record<ParcelId, number[]>
  layers: {
    moist_layers: LayerBand[]
    dry_layers: LayerBand[]
    cap_layers: LayerBand[]
  }
}
