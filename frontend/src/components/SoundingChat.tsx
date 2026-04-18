import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { streamSoundingChat, type ChatMessage } from '../api'
import type { SoundingAnalysis } from '../types'

export type SoundingChatMeta = {
  station_name?: string
  station_code?: string
  utc_hour?: number
  utc_day?: number
  utc_month_name?: string
  utc_year?: number
}

const DEFAULT_PROMPT = 'Provide a technical severe weather outlook from this sounding.'

const CSV_MAX_CHARS = 40_000
const CSV_SAMPLE_OPTIONS = [25, 50, 100, 200, 500, 0] as const
const CSV_SAMPLE_DEFAULT: (typeof CSV_SAMPLE_OPTIONS)[number] = 100

type CsvSample = {
  text: string
  rows: number
  total: number
  stride: number
}

function sampleIndices(total: number, maxRows: number): { indices: number[]; stride: number } {
  if (total <= 0) return { indices: [], stride: 1 }
  if (maxRows <= 0 || total <= maxRows) {
    return { indices: Array.from({ length: total }, (_, i) => i), stride: 1 }
  }
  const stride = Math.max(1, Math.ceil(total / maxRows))
  const indices: number[] = []
  for (let i = 0; i < total; i += stride) indices.push(i)
  const last = total - 1
  if (indices[indices.length - 1] !== last) indices.push(last)
  return { indices, stride }
}

function buildSoundingCsv(data: SoundingAnalysis | null | undefined, maxRows: number): CsvSample | null {
  if (!data || !data.levels?.length) return null
  const total = data.levels.length
  const { indices, stride } = sampleIndices(total, maxRows)
  const header = 'pressure_mb,height_m,temperature_c,dewpoint_c,u_ms,v_ms,rh_pct'
  const lines: string[] = [header]
  for (const i of indices) {
    const lv = data.levels[i]
    if (!lv) continue
    lines.push(
      [
        lv.p_mb?.toFixed(2) ?? '',
        lv.z_m != null ? lv.z_m.toFixed(1) : '',
        lv.t_c != null ? lv.t_c.toFixed(2) : '',
        lv.td_c != null ? lv.td_c.toFixed(2) : '',
        lv.u_ms != null ? lv.u_ms.toFixed(2) : '',
        lv.v_ms != null ? lv.v_ms.toFixed(2) : '',
        lv.rh_pct != null ? lv.rh_pct.toFixed(1) : '',
      ].join(','),
    )
  }
  let text = lines.join('\n')
  if (text.length > CSV_MAX_CHARS) text = text.slice(0, CSV_MAX_CHARS) + '\n# (truncated)'
  return { text, rows: indices.length, total, stride }
}

async function copyRichText(html: string, fallbackText: string): Promise<void> {
  const nav = navigator as Navigator & {
    clipboard?: Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> }
  }
  if (typeof ClipboardItem !== 'undefined' && nav.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([fallbackText], { type: 'text/plain' }),
    })
    await nav.clipboard.write([item])
    return
  }
  await navigator.clipboard.writeText(fallbackText)
}

type AssistantMessageProps = {
  content: string
  streaming: boolean
}

function AssistantMessage({ content, streaming }: AssistantMessageProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [flash, setFlash] = useState<'rich' | 'md' | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1200)
    return () => clearTimeout(t)
  }, [flash])

  const doCopy = useCallback(
    async (mode: 'rich' | 'md') => {
      setMenuOpen(false)
      try {
        if (mode === 'md') {
          await navigator.clipboard.writeText(content)
        } else {
          const html = bodyRef.current?.innerHTML ?? ''
          await copyRichText(html, content)
        }
        setFlash(mode)
      } catch {
        setFlash(null)
      }
    },
    [content],
  )

  return (
    <div className="soundingChatBubble assistant">
      {content ? (
        <>
          <div ref={bodyRef} className="soundingChatMarkdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
          <div className="soundingChatBubbleActions" ref={menuRef}>
            <button
              type="button"
              className="btn soundingChatCopyBtn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Copy this response"
            >
              {flash === 'rich' ? 'Copied rich text' : flash === 'md' ? 'Copied markdown' : 'Copy ▾'}
            </button>
            {menuOpen && (
              <div className="soundingChatCopyMenu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="soundingChatCopyItem"
                  onClick={() => void doCopy('rich')}
                >
                  Copy as rich text
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="soundingChatCopyItem"
                  onClick={() => void doCopy('md')}
                >
                  Copy as markdown
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <span className="soundingChatStreamingDots">{streaming ? '…' : ''}</span>
      )}
    </div>
  )
}

function captureStagePng(): { dataUrl: string; b64: string } | null {
  const canvas = document.querySelector('.stage canvas') as HTMLCanvasElement | null
  if (!canvas) return null
  try {
    const dataUrl = canvas.toDataURL('image/png')
    const prefix = 'data:image/png;base64,'
    if (!dataUrl.startsWith(prefix)) return null
    return { dataUrl, b64: dataUrl.slice(prefix.length) }
  } catch {
    return null
  }
}

function buildMetaPrefix(meta: SoundingChatMeta | null | undefined): string {
  if (!meta) return ''
  const parts: string[] = []
  if (meta.station_name || meta.station_code) {
    parts.push(
      [meta.station_name, meta.station_code && `(${meta.station_code})`].filter(Boolean).join(' '),
    )
  }
  const when = [meta.utc_hour != null && `${meta.utc_hour}Z`, meta.utc_day, meta.utc_month_name, meta.utc_year]
    .filter(Boolean)
    .join(' ')
  if (when.trim()) parts.push(when)
  if (!parts.length) return ''
  return `(Context: ${parts.join(' — ')})\n\n`
}

type Props = {
  meta?: SoundingChatMeta | null
  /** Raw analysis for optional CSV attachment. */
  sounding?: SoundingAnalysis | null
  /** When true, show a narrow rail to expand the panel. */
  collapsed: boolean
  onExpand?: () => void
}

export function SoundingChat({ meta, sounding, collapsed, onExpand }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState(DEFAULT_PROMPT)
  const [streaming, setStreaming] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [includeSnapshotNext, setIncludeSnapshotNext] = useState(false)
  const [includeCsvNext, setIncludeCsvNext] = useState(false)
  const [csvMaxRows, setCsvMaxRows] = useState<(typeof CSV_SAMPLE_OPTIONS)[number]>(CSV_SAMPLE_DEFAULT)
  const [firstSnapshotUrl, setFirstSnapshotUrl] = useState<string | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  const csvSample = useMemo(() => buildSoundingCsv(sounding ?? null, csvMaxRows), [sounding, csvMaxRows])
  const csvAvailable = csvSample != null

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return

    const userTurns = messages.filter((m) => m.role === 'user').length
    const isFirstUser = userTurns === 0
    const needImage = isFirstUser || includeSnapshotNext

    let imageB64: string | null = null
    if (needImage) {
      const cap = captureStagePng()
      if (!cap) {
        setErr('No scene canvas found. Load a sounding and wait for the 3D view.')
        return
      }
      imageB64 = cap.b64
      if (isFirstUser) {
        setFirstSnapshotUrl(cap.dataUrl)
      }
    }

    const attachCsv = includeCsvNext && csvSample != null
    const csvBlock = attachCsv
      ? `\n\nRaw sounding profile (CSV, ${csvSample.rows} of ${csvSample.total} levels, every ${csvSample.stride}${csvSample.stride === 1 ? 'st' : 'th'} sample):\n\`\`\`csv\n${csvSample.text}\n\`\`\``
      : ''
    const userContent = (isFirstUser ? buildMetaPrefix(meta) : '') + trimmed + csvBlock
    const userMsg: ChatMessage = { role: 'user', content: userContent }
    const historyForApi = [...messages, userMsg]
    setErr(null)
    setInput('')
    setIncludeSnapshotNext(false)
    setIncludeCsvNext(false)
    setStreaming(true)

    setMessages([...historyForApi, { role: 'assistant', content: '' }])

    try {
      for await (const chunk of streamSoundingChat(historyForApi, imageB64)) {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + chunk }
          }
          return next
        })
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      if (isFirstUser) setFirstSnapshotUrl(null)
      setMessages((prev) => {
        const next = [...prev]
        if (next.length && next[next.length - 1]?.role === 'assistant') next.pop()
        if (next.length && next[next.length - 1]?.role === 'user') next.pop()
        return next
      })
      setInput(trimmed)
    } finally {
      setStreaming(false)
    }
  }, [input, messages, meta, streaming, includeSnapshotNext, includeCsvNext, csvSample])

  const clearChat = useCallback(() => {
    if (streaming) return
    setMessages([])
    setFirstSnapshotUrl(null)
    setErr(null)
    setIncludeSnapshotNext(false)
    setIncludeCsvNext(false)
    setInput(DEFAULT_PROMPT)
  }, [streaming])

  if (collapsed) {
    return (
      <aside className="chatPanel rail" aria-label="AI chat collapsed">
        <button type="button" className="chatRailBtn" onClick={() => onExpand?.()} title="Expand AI chat">
          <span className="chatRailLabel">AI</span>
        </button>
      </aside>
    )
  }

  const firstUserIndex = messages.findIndex((m) => m.role === 'user')

  return (
    <aside className="chatPanel" aria-label="AI chat">
      <div className="soundingChatHeader">
        <h2 className="soundingChatTitle">Analyze with AI</h2>
        <button
          type="button"
          className="btn soundingChatClear"
          disabled={streaming || messages.length === 0}
          onClick={clearChat}
          title="Clear the current conversation"
        >
          Clear chat
        </button>
      </div>

      <div className="soundingChatTranscript">
        {messages.length === 0 && (
          <p className="soundingChatHint">
            Send a message to stream a severe-weather outlook from the current scene snapshot (first message includes
            the image).
          </p>
        )}
        {messages.map((m, i) => {
          if (m.role === 'system') return null
          const isUser = m.role === 'user'
          const showThumb = isUser && i === firstUserIndex && firstSnapshotUrl
          return (
            <div key={i} className={`soundingChatMsg ${isUser ? 'user' : 'assistant'}`}>
              {showThumb && (
                <div className="soundingChatThumbWrap">
                  <img src={firstSnapshotUrl} alt="Snapshot sent to the model" className="soundingChatThumb" />
                </div>
              )}
              {isUser ? (
                <div className="soundingChatBubble user">{m.content}</div>
              ) : (
                <AssistantMessage
                  content={m.content}
                  streaming={streaming && i === messages.length - 1}
                />
              )}
            </div>
          )
        })}
        <div ref={transcriptEndRef} />
      </div>

      {err && <div className="soundingChatError">{err}</div>}

      <div className="soundingChatComposer">
        <div className="soundingChatActions">
          <button
            type="button"
            className={includeSnapshotNext ? 'btn toggle active' : 'btn toggle'}
            disabled={streaming}
            onClick={() => setIncludeSnapshotNext((v) => !v)}
            title="Next message will include a fresh snapshot"
          >
            {includeSnapshotNext ? 'Snapshot on next send' : 'Snapshot scene'}
          </button>
          <button
            type="button"
            className={includeCsvNext ? 'btn toggle active' : 'btn toggle'}
            disabled={streaming || !csvAvailable}
            onClick={() => setIncludeCsvNext((v) => !v)}
            title={
              csvSample
                ? `Attach ${csvSample.rows} of ${csvSample.total} levels (every ${csvSample.stride}${
                    csvSample.stride === 1 ? 'st' : 'th'
                  } sample) to the next message`
                : 'Load a sounding first'
            }
          >
            {includeCsvNext && csvSample
              ? `CSV attached (${csvSample.rows})`
              : 'Attach CSV data'}
          </button>
          <label className="soundingChatSampleSelect" title="Maximum CSV rows to attach (sampled linearly)">
            <span className="sr-only">CSV sample size</span>
            <select
              value={csvMaxRows}
              disabled={streaming || !csvAvailable}
              onChange={(e) => setCsvMaxRows(Number(e.target.value) as (typeof CSV_SAMPLE_OPTIONS)[number])}
            >
              {CSV_SAMPLE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'All rows' : `Max ${n} rows`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          className="soundingChatInput"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this sounding…"
          disabled={streaming}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="btn primary soundingChatSend" disabled={streaming || !input.trim()} onClick={() => void send()}>
          {streaming ? 'Thinking…' : 'Send'}
        </button>
      </div>
    </aside>
  )
}
