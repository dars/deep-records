import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isKnownFlag } from '../shared/flags'
import { sceneIds, endingIds } from '../worker/generated/content'
import { endingIds as feEndingIds } from '../src/generated/registry'
import { transitionRules } from '../worker/config/transitions'

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'generated' || name === 'node_modules') {
      return []
    }

    const full = join(dir, name)

    if (statSync(full).isDirectory()) {
      return listSourceFiles(full)
    }

    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

// 從原始碼抽出「程式碼寫死的旗標」：
//  - flags.xxx / flags?.xxx 存取
//  - requiresFlag / blockedByFlag 設定
//  - setFlags / markFlags 物件字面值的鍵
function extractFlagLiterals(source: string): string[] {
  const found: string[] = []

  for (const match of source.matchAll(/flags\??\.([a-z][a-z0-9]*_[a-z0-9_]+)/g)) {
    found.push(match[1])
  }

  for (const match of source.matchAll(
    /(?:requiresFlag|blockedByFlag):\s*'([a-z0-9_]+)'/g,
  )) {
    found.push(match[1])
  }

  for (const match of source.matchAll(
    /(?:setFlags|markFlags)(?:\?\.|\s*:\s*)\{([^}]*)\}/gs,
  )) {
    for (const key of match[1].matchAll(/([a-z][a-z0-9]*_[a-z0-9_]+)\s*:/g)) {
      found.push(key[1])
    }
  }

  for (const match of source.matchAll(/setFlags\?\.([a-z][a-z0-9_]{3,})/g)) {
    found.push(match[1])
  }

  return found
}

describe('旗標註冊表', () => {
  it('程式碼寫死的旗標都必須在 shared/flags.ts 宣告', () => {
    const files = [
      ...listSourceFiles(join(__dirname, '../worker')),
      ...listSourceFiles(join(__dirname, '../src')),
    ]
    const unknown = new Map<string, string>()

    for (const file of files) {
      const source = readFileSync(file, 'utf-8')

      for (const flag of extractFlagLiterals(source)) {
        if (!isKnownFlag(flag)) {
          unknown.set(flag, file)
        }
      }
    }

    expect(
      [...unknown].map(([flag, file]) => `${flag} (${file})`),
    ).toEqual([])
  })
})

describe('id 註冊表一致性', () => {
  it('前端結局圖鑑清單與內容層一致（同一 codegen 來源）', () => {
    expect([...feEndingIds]).toEqual([...endingIds])
  })

  it('罐頭轉場的場景 id 都存在於內容層', () => {
    const known = new Set<string>(sceneIds)

    for (const rule of transitionRules) {
      expect(known.has(rule.from), `from: ${rule.from}`).toBe(true)
      expect(known.has(rule.to), `to: ${rule.to}`).toBe(true)
    }
  })
})
