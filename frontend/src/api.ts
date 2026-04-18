import type { SoundingAnalysis } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function* streamSoundingChat(
  messages: ChatMessage[],
  imageB64: string | null,
  options?: { useDefaultSystemPrompt?: boolean },
): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/api/chat/sounding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      image_b64: imageB64,
      use_default_system_prompt: options?.useDefaultSystemPrompt ?? true,
    }),
  })
  if (!res.ok || !res.body) {
    throw new Error((await res.text()) || `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      const evt = JSON.parse(line) as {
        message?: { content?: string }
        done?: boolean
        error?: string
      }
      if (evt.error) {
        throw new Error(evt.error)
      }
      if (evt.message?.content) {
        yield evt.message.content
      }
    }
  }
}

export async function analyzeSoundingUrl(url: string): Promise<SoundingAnalysis> {
  const res = await fetch(`${BASE}/api/sounding/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = (err as { detail?: string }).detail ?? res.statusText
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json() as Promise<SoundingAnalysis>
}
