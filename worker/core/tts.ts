// ElevenLabs 語音合成代理：金鑰只存在 worker secret，
// 以文字雜湊做 Cache API 快取（同段敘事重聽不重複扣credits）。
type TtsEnv = {
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_MODEL_ID?: string
  ELEVENLABS_VOICE_ID?: string
  TTS_CACHE?: KVNamespace
}

// 預設 eleven_flash_v2_5（低延遲、半價）；wrangler.toml 可覆寫，
// 例如 eleven_v3（最具表現力）或 eleven_multilingual_v2（克隆聲一致性最佳）。
const defaultModelId = 'eleven_flash_v2_5'
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
  const modelId = env.ELEVENLABS_MODEL_ID ?? defaultModelId
  const cacheHash = await buildCacheHash(text, voiceId, modelId)
  const cached = await env.TTS_CACHE?.get(cacheHash, 'arrayBuffer')

  if (cached) {
    return audioResponse(cached, corsHeaders)
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      body: JSON.stringify({
        model_id: modelId,
        text,
        // v3 系列的參數介面不同，不帶舊版 voice_settings。
        ...(modelId.startsWith('eleven_v3')
          ? {}
          : {
              voice_settings: {
                similarity_boost: 0.75,
                stability: 0.5,
                style: 0.25,
              },
            }),
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

  if (env.TTS_CACHE) {
    ctx.waitUntil(
      env.TTS_CACHE.put(cacheHash, audio, { expirationTtl: 60 * 60 * 24 * 7 }),
    )
  }

  return audioResponse(audio, corsHeaders)
}

async function buildCacheHash(
  text: string,
  voiceId: string,
  modelId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${voiceId}:${modelId}:${text}`),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function audioResponse(
  audio: ArrayBuffer,
  extraHeaders: Record<string, string>,
) {
  return new Response(audio, {
    headers: {
      ...extraHeaders,
      'Cache-Control': 'public, max-age=604800',
      'Content-Type': 'audio/mpeg',
    },
  })
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
