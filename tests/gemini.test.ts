import { afterEach, describe, expect, it, vi } from 'vitest'
import { callGeminiKeeper } from '../worker/core/gemini'

describe('callGeminiKeeper：額度／頻率耗盡標記', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('重試耗盡後仍是 429：回傳 quotaExhausted=true，response 降級為 undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGeminiKeeper({ GEMINI_API_KEY: 'test-key' }, '測試 prompt')

    expect(result.response).toBeUndefined()
    expect(result.quotaExhausted).toBe(true)
  }, 10_000)

  it('其他連線層失敗（如逾時／5xx 重試耗盡）不標記 quotaExhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGeminiKeeper({ GEMINI_API_KEY: 'test-key' }, '測試 prompt')

    expect(result.response).toBeUndefined()
    expect(result.quotaExhausted).toBeFalsy()
  }, 10_000)
})
