import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { streamSoundingChat, type ChatMessage } from '../api'

export type SoundingChatMeta = {
  station_name?: string
  station_code?: string
  utc_hour?: number
  utc_day?: number
  utc_month_name?: string
  utc_year?: number
}

const DEFAULT_PROMPT = 'Provide a technical severe weather outlook from this sounding.'

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
  open: boolean
  onClose: () => void
  meta?: SoundingChatMeta | null
}

export function SoundingChat({ open, onClose, meta }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState(DEFAULT_PROMPT)
  const [streaming, setStreaming] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [includeSnapshotNext, setIncludeSnapshotNext] = useState(false)
  const [firstSnapshotUrl, setFirstSnapshotUrl] = useState<string | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setMessages([])
      setInput(DEFAULT_PROMPT)
      setErr(null)
      setStreaming(false)
      setIncludeSnapshotNext(false)
      setFirstSnapshotUrl(null)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

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

    const userContent = (isFirstUser ? buildMetaPrefix(meta) : '') + trimmed
    const userMsg: ChatMessage = { role: 'user', content: userContent }
    const historyForApi = [...messages, userMsg]
    setErr(null)
    setInput('')
    setIncludeSnapshotNext(false)
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
  }, [input, messages, meta, streaming, includeSnapshotNext])

  if (!open) return null

  const firstUserIndex = messages.findIndex((m) => m.role === 'user')

  return (
    <div className="soundingChatDrawer" role="dialog" aria-labelledby="sounding-chat-title">
      <div className="soundingChatHeader">
        <h2 id="sounding-chat-title" className="soundingChatTitle">
          Analyze with AI
        </h2>
        <button type="button" className="btn soundingChatClose" onClick={onClose} aria-label="Close chat">
          Close
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
                <div className="soundingChatBubble assistant">
                  {m.content ? (
                    <div className="soundingChatMarkdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="soundingChatStreamingDots">{streaming && i === messages.length - 1 ? '…' : ''}</span>
                  )}
                </div>
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
    </div>
  )
}
