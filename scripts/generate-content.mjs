// 掃描 scenarios/**/*.md 的 frontmatter，產生 worker/generated/content.ts。
// 新增場景、道具、結局、職業或參考文件時，只需要新增 md 檔並重新執行本腳本。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const scenariosDir = join(projectRoot, 'scenarios')
const outputFile = join(projectRoot, 'worker', 'generated', 'content.ts')
const moodsOutputFile = join(projectRoot, 'src', 'generated', 'scene-moods.ts')

function walkMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      return walkMarkdownFiles(fullPath)
    }

    return entry.name.endsWith('.md') ? [fullPath] : []
  })
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/)

  if (!match) {
    return {}
  }

  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([a-zA-Z_]+):\s*(.*)$/))
      .filter(Boolean)
      .map((lineMatch) => [lineMatch[1], lineMatch[2].trim()]),
  )
}

function parseList(value) {
  if (!value) {
    return []
  }

  const trimmed = value.trim().replace(/^\[|\]$/g, '')

  return trimmed
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

const files = walkMarkdownFiles(scenariosDir).sort()
const entries = files.map((filePath, index) => {
  const markdown = readFileSync(filePath, 'utf-8')
  const frontmatter = parseFrontmatter(markdown)
  const relativePath = relative(join(projectRoot, 'worker', 'generated'), filePath)
  const fallbackId = relative(scenariosDir, filePath).replace(/\.md$/, '').replaceAll('/', '_')

  if (!frontmatter.id) {
    throw new Error(`Missing frontmatter id in ${filePath}`)
  }

  return {
    connectsTo: parseList(frontmatter.connects_to),
    id: frontmatter.id ?? fallbackId,
    importName: `md${index}`,
    importPath: relativePath,
    itemsAvailable: parseList(frontmatter.items_available),
    musicMood: frontmatter.music_mood ?? '',
    once: frontmatter.once === 'true',
    references: parseList(frontmatter.references),
    title: frontmatter.title ?? frontmatter.id,
    type: frontmatter.type ?? 'unknown',
  }
})

const knownTypes = new Set([
  'scene',
  'prologue',
  'item',
  'ending',
  'occupation',
  'character',
  'faction',
  'keeper_reference',
])

for (const entry of entries) {
  if (!knownTypes.has(entry.type)) {
    throw new Error(`Unknown frontmatter type "${entry.type}" (${entry.id})`)
  }
}

const duplicateIds = entries
  .map((entry) => entry.id)
  .filter((id, index, ids) => ids.indexOf(id) !== index)

if (duplicateIds.length > 0) {
  throw new Error(`Duplicate frontmatter ids: ${duplicateIds.join(', ')}`)
}

function record(list, mapper) {
  return `{\n${list.map((entry) => `  ${JSON.stringify(entry.id)}: ${mapper(entry)},`).join('\n')}\n}`
}

function sceneRecord(entry) {
  return `{
    connectsTo: ${JSON.stringify(entry.connectsTo)},
    id: ${JSON.stringify(entry.id)},
    itemsAvailable: ${JSON.stringify(entry.itemsAvailable)},
    markdown: ${entry.importName},
    references: ${JSON.stringify(entry.references)},
    title: ${JSON.stringify(entry.title)},
  }`
}

function itemRecord(entry) {
  return `{
    id: ${JSON.stringify(entry.id)},
    markdown: ${entry.importName},
    once: ${entry.once},
    title: ${JSON.stringify(entry.title)},
  }`
}

function docRecord(entry) {
  return `{
    id: ${JSON.stringify(entry.id)},
    markdown: ${entry.importName},
    title: ${JSON.stringify(entry.title)},
  }`
}

const scenes = entries.filter((entry) => entry.type === 'scene' || entry.type === 'prologue')
const items = entries.filter((entry) => entry.type === 'item')
const endings = entries.filter((entry) => entry.type === 'ending')
const occupations = entries.filter((entry) => entry.type === 'occupation')
const characters = entries.filter((entry) => entry.type === 'character')
const factions = entries.filter((entry) => entry.type === 'faction')
const keeperReferences = entries.filter((entry) => entry.type === 'keeper_reference')

const output = `// 本檔案由 scripts/generate-content.mjs 產生，請勿手動編輯。
// 重新產生：npm run generate
${entries.map((entry) => `import ${entry.importName} from '${entry.importPath}'`).join('\n')}

export type SceneDefinition = {
  connectsTo: string[]
  id: string
  itemsAvailable: string[]
  markdown: string
  references: string[]
  title: string
}

export type ItemDefinition = {
  id: string
  markdown: string
  once: boolean
  title: string
}

export type DocDefinition = {
  id: string
  markdown: string
  title: string
}

export const scenes: Record<string, SceneDefinition> = ${record(scenes, sceneRecord)}

export const items: Record<string, ItemDefinition> = ${record(items, itemRecord)}

export const endings: Record<string, DocDefinition> = ${record(endings, docRecord)}

export const occupations: Record<string, DocDefinition> = ${record(occupations, docRecord)}

export const characters: Record<string, DocDefinition> = ${record(characters, docRecord)}

export const factions: Record<string, DocDefinition> = ${record(factions, docRecord)}

export const keeperReferences: Record<string, DocDefinition> = ${record(keeperReferences, docRecord)}

export const occupationAliases: Record<string, string> = {
${occupations
  .flatMap((entry) => [
    `  ${JSON.stringify(entry.id)}: ${JSON.stringify(entry.id)},`,
    `  ${JSON.stringify(entry.id.replace(/^occupation_/, ''))}: ${JSON.stringify(entry.id)},`,
    `  ${JSON.stringify(entry.title)}: ${JSON.stringify(entry.id)},`,
  ])
  .join('\n')}
}
`

mkdirSync(dirname(outputFile), { recursive: true })
writeFileSync(outputFile, output)

// 前端用的場景音樂情境表（music_mood frontmatter）。
const moodsOutput = `// 本檔案由 scripts/generate-content.mjs 產生，請勿手動編輯。
export const sceneMoods: Record<string, string> = {
${scenes
  .filter((entry) => entry.musicMood)
  .map((entry) => `  ${JSON.stringify(entry.id)}: ${JSON.stringify(entry.musicMood)},`)
  .join('\n')}
}
`

mkdirSync(dirname(moodsOutputFile), { recursive: true })
writeFileSync(moodsOutputFile, moodsOutput)
console.log(
  `Generated ${relative(projectRoot, outputFile)}: ${scenes.length} scenes, ${items.length} items, ${endings.length} endings, ${occupations.length} occupations, ${characters.length} characters, ${factions.length} factions, ${keeperReferences.length} references`,
)
