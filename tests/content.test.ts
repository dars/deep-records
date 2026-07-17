import { describe, expect, it } from 'vitest'
import { transitionRules } from '../worker/config/transitions'
import { referenceLibrary } from '../worker/config/references'
import {
  endings,
  items,
  occupationAliases,
  occupations,
  scenes,
} from '../worker/generated/content'

describe('generated content integrity', () => {
  it('每條確定性轉場的目標場景都必須在 from 場景的 connects_to 裡', () => {
    for (const rule of transitionRules) {
      const fromScene = scenes[rule.from]

      expect(fromScene, `unknown from scene: ${rule.from}`).toBeDefined()
      expect(scenes[rule.to], `unknown to scene: ${rule.to}`).toBeDefined()
      expect(
        fromScene.connectsTo,
        `${rule.from} -> ${rule.to} 不在 connects_to`,
      ).toContain(rule.to)
    }
  })

  it('場景 frontmatter 的 references 都必須存在於 referenceLibrary', () => {
    for (const scene of Object.values(scenes)) {
      for (const referenceId of scene.references) {
        expect(
          referenceLibrary[referenceId],
          `${scene.id} 引用了不存在的 reference: ${referenceId}`,
        ).toBeDefined()
      }
    }
  })

  it('場景 items_available 都必須是已定義的道具', () => {
    for (const scene of Object.values(scenes)) {
      for (const itemId of scene.itemsAvailable) {
        expect(items[itemId], `${scene.id} 引用了不存在的道具: ${itemId}`).toBeDefined()
      }
    }
  })

  it('connects_to 之間必須指向存在的場景', () => {
    for (const scene of Object.values(scenes)) {
      for (const connectedId of scene.connectsTo) {
        expect(
          scenes[connectedId],
          `${scene.id} 連到不存在的場景: ${connectedId}`,
        ).toBeDefined()
      }
    }
  })

  it('主要結局都存在且有標題', () => {
    for (const endingId of [
      'ending_ordinary_departure',
      'ending_uneasy_departure',
      'ending_surrendered_evidence',
      'ending_suppressed_truth',
      'ending_buried_together',
      'ending_great_witness',
      'ending_truth_in_hand',
    ]) {
      expect(endings[endingId]).toBeDefined()
      expect(endings[endingId].title.length).toBeGreaterThan(0)
    }
  })

  it('職業別名（id、短名、中文）都指向存在的職業', () => {
    expect(occupationAliases['軟體工程師']).toBe('occupation_software_engineer')
    expect(occupationAliases.software_engineer).toBe('occupation_software_engineer')

    for (const occupationId of Object.values(occupationAliases)) {
      expect(occupations[occupationId]).toBeDefined()
    }
  })
})
