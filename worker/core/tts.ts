// ElevenLabs 語音合成代理：金鑰只存在 worker secret，
// 以文字雜湊做 Cache API 快取（同段敘事重聽不重複扣credits）。
type TtsEnv = {
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_VOICE_ID?: string
}

// eleven_flash_v2_5：低延遲、半價 credits，支援中文。
// 想換更高品質可改 'eleven_multilingual_v2'。
const elevenLabsModel = 'eleven_flash_v2_5'
const defaultVoiceId = 'JBFqnCBsd6RMkjVDRZzb'
const maxTextLength = 1200

export async function handleTtsRequest(
  request: Request,
  env: TtsEnv,
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.ELEVENLABS_API_KEY) {
    return jsonResponse(
      { error: 'tts_unavailable', message: '語音服務尚未設定。' },
      503,
      corsHeaders,
    )
  }

  let text = ''

  try {
    const body = (await request.json()) as { text?: unknown }

    if (typeof body.text === 'string') {
      text = body.text
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maxTextLength)
    }
  } catch {
    text = ''
  }

  if (!text) {
    return jsonResponse({ error: 'invalid_text' }, 400, corsHeaders)
  }

  const voiceId = env.ELEVENLABS_VOICE_ID ?? defaultVoiceId
  const cacheKey = await buildCacheKey(text, voiceId)
  const cache = caches.default
  const cached = await cache.match(cacheKey)

  if (cached) {
    return withHeaders(cached, corsHeaders)
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      body: JSON.stringify({
        model_id: elevenLabsModel,
        text,
        voice_settings: {
          similarity_boost: 0.75,
          stability: 0.5,
          style: 0.25,
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': env.ELEVENLABS_API_KEY,
      },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    },
  )

  if (!upstream.ok) {
    const detail = await upstream.text()
    console.error('tts_upstream_failed', upstream.status, detail.slice(0, 300))

    return jsonResponse(
      { error: 'tts_failed', message: '語音合成暫時無法使用。' },
      502,
      corsHeaders,
    )
  }

  const audio = await upstream.arrayBuffer()
  const response = new Response(audio, {
    headers: {
      'Cache-Control': 'public, max-age=604800',
      'Content-Type': 'audio/mpeg',
    },
  })

  ctx.waitUntil(cache.put(cacheKey, response.clone()))

  return withHeaders(response, corsHeaders)
}

async function buildCacheKey(text: string, voiceId: string): Promise<Request> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${voiceId}:${elevenLabsModel}:${text}`),
  )
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return new Request(`https://tts-cache.deep-records.internal/${hash}`)
}

function withHeaders(response: Response, extraHeaders: Record<string, string>) {
  const wrapped = new Response(response.body, response)

  for (const [key, value] of Object.entries(extraHeaders)) {
    wrapped.headers.set(key, value)
  }

  return wrapped
}

function jsonResponse(
  data: unknown,
  status: number,
  extraHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  })
}
