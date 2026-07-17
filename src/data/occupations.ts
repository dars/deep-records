import {
  defaultInvestigatorProfile,
  type InvestigatorProfile,
} from '../types/investigation'

export type OccupationOption = {
  attributes: Array<[string, string]>
  creditRatingRange: [number, number]
  id: string
  sourcePath: string
  title: string
}

const occupationModules = import.meta.glob<string>(
  '../../scenarios/occupation/*.md',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

export const occupationOptions = Object.entries(occupationModules)
  .map(([sourcePath, markdown]) => parseOccupationMarkdown(sourcePath, markdown))
  .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'))

export const defaultOccupationOption =
  occupationOptions.find((occupation) => occupation.id === 'occupation_software_engineer') ??
  occupationOptions[0]

const occupationProfileOverrides: Record<
  string,
  Pick<InvestigatorProfile, 'hitPoints' | 'initialInventory' | 'skills'>
> = {
  occupation_college_student: {
    hitPoints: 11,
    initialInventory: [
      '智慧型手機',
      '學生證',
      '行動電源與充電線',
      '後背包與筆記用品',
      '耳機',
      '現金與悠遊卡',
    ],
    skills: [
      ['圖書館使用', '70'],
      ['電腦使用', '60'],
      ['偵查', '60'],
      ['外語（英語）', '55'],
      ['心理學', '50'],
      ['說服', '50'],
      ['攝影', '50'],
      ['聆聽', '50'],
    ],
  },
  occupation_firefighter: {
    hitPoints: 13,
    initialInventory: [
      '智慧型手機',
      '消防人員工作識別證',
      '小型高亮度手電筒',
      '輕便工作手套',
      '簡易隨身急救用品',
      '現金與悠遊卡',
    ],
    skills: [
      ['急救', '70'],
      ['閃避', '60'],
      ['攀爬', '60'],
      ['跳躍', '55'],
      ['駕駛（汽車）', '50'],
      ['機械維修', '50'],
      ['投擲', '50'],
      ['操作重型機械', '45'],
    ],
  },
  occupation_nurse: {
    hitPoints: 11,
    initialInventory: [
      '智慧型手機',
      '醫療機構工作識別證',
      '個人用口罩',
      '酒精棉片',
      '簡易隨身急救用品',
      '現金與悠遊卡',
    ],
    skills: [
      ['急救', '75'],
      ['醫學', '65'],
      ['心理學', '60'],
      ['生物學', '60'],
      ['聆聽', '55'],
      ['說服', '55'],
      ['藥學', '50'],
      ['電腦使用', '45'],
    ],
  },
  occupation_office_worker: {
    hitPoints: 11,
    initialInventory: [
      '智慧型手機',
      '公司識別證與名片',
      '充電線',
      '原子筆與小型記事本',
      '折疊傘',
      '現金與悠遊卡',
    ],
    skills: [
      ['電腦使用', '65'],
      ['心理學', '60'],
      ['說服', '60'],
      ['圖書館使用', '55'],
      ['話術', '55'],
      ['會計', '50'],
      ['駕駛（汽車）', '45'],
      ['法律', '40'],
    ],
  },
  occupation_police_officer: {
    hitPoints: 12,
    initialInventory: [
      '智慧型手機',
      '警察服務證',
      '小型手電筒',
      '隨身記事本與原子筆',
      '私人交通工具鑰匙',
      '現金與悠遊卡',
    ],
    skills: [
      ['偵查', '70'],
      ['法律', '65'],
      ['心理學', '60'],
      ['聆聽', '60'],
      ['射擊（手槍）', '60'],
      ['格鬥（鬥毆）', '60'],
      ['說服', '55'],
      ['駕駛（汽車）', '50'],
    ],
  },
  occupation_software_engineer: {
    hitPoints: 11,
    initialInventory: [
      '內建 microSD 讀卡槽的私人筆記型電腦',
      '智慧型手機',
      '未完成的工作專案',
      '現金與悠遊卡',
    ],
    skills: [
      ['電腦使用', '75'],
      ['圖書館使用', '55'],
      ['電子學', '50'],
      ['科學（密碼學）', '45'],
      ['母語', '80'],
      ['英語', '55'],
      ['心理學', '45'],
      ['鎖匠開鎖', '35'],
    ],
  },
}

export function createInvestigatorProfile(
  name: string,
  occupation: OccupationOption,
): InvestigatorProfile {
  const profileOverride = occupationProfileOverrides[occupation.id]

  return {
    ...defaultInvestigatorProfile,
    ...profileOverride,
    attributes: occupation.attributes,
    creditRating: getCreditRatingMidpoint(occupation.creditRatingRange),
    name: name.trim(),
    occupationId: occupation.id,
    occupationTitle: occupation.title,
  }
}

function parseOccupationMarkdown(
  sourcePath: string,
  markdown: string,
): OccupationOption {
  const frontmatter = parseFrontmatter(markdown)
  const fallbackTitle =
    sourcePath
      .split('/')
      .at(-1)
      ?.replace(/\.md$/, '')
      .replace(/_/g, ' ') ?? '未知職業'

  return {
    attributes: parseAttributes(markdown),
    creditRatingRange: parseCreditRatingRange(frontmatter.credit_rating),
    id: frontmatter.id ?? fallbackTitle,
    sourcePath,
    title: frontmatter.title ?? fallbackTitle,
  }
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n(?<content>[\s\S]*?)\n---/)
  const content = match?.groups?.content ?? ''
  const entries = content
    .split('\n')
    .map((line) => line.match(/^(?<key>[a-zA-Z_]+):\s*(?<value>.+)$/))
    .filter((lineMatch): lineMatch is RegExpMatchArray => Boolean(lineMatch))
    .map((lineMatch) => [
      lineMatch.groups?.key ?? '',
      lineMatch.groups?.value?.trim() ?? '',
    ])

  return Object.fromEntries(entries) as Partial<{
    credit_rating: string
    id: string
    title: string
  }>
}

function parseAttributes(markdown: string): Array<[string, string]> {
  const section = markdown.match(/## attributes\s*\n(?<content>[\s\S]*?)(?:\n## |\n?$)/)
  const attributes =
    section?.groups?.content
      .split('\n')
      .map((line) => line.match(/^-\s*(?<label>\S+)\s+(?<value>\d+)/))
      .filter((lineMatch): lineMatch is RegExpMatchArray => Boolean(lineMatch))
      .map((lineMatch): [string, string] => [
        lineMatch.groups?.label ?? '',
        lineMatch.groups?.value ?? '',
      ])
      .filter(([label, value]) => label && value) ?? []

  return attributes.length > 0 ? attributes : defaultInvestigatorProfile.attributes
}

function parseCreditRatingRange(value: string | undefined): [number, number] {
  const numbers = value?.match(/\d+/g)?.map(Number) ?? []

  if (numbers.length >= 2) {
    return [numbers[0], numbers[1]]
  }

  return [30, 60]
}

function getCreditRatingMidpoint([min, max]: [number, number]) {
  return Math.round((min + max) / 2)
}
