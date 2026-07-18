export type RecordTab = 'character' | 'clues' | 'items' | 'logs'

export const recordTabs: Array<{ id: RecordTab; label: string }> = [
  { id: 'character', label: '角色' },
  { id: 'clues', label: '線索' },
  { id: 'items', label: '物品' },
  { id: 'logs', label: '紀錄' },
]

export const playerRecord = {
  fileId: 'INVESTIGATOR FILE / 001',
  name: '林亦辰',
  note: '職業標籤：軟體工程師。以下資料為目前調查紀錄中可確認的狀態。',
  summary: [
    ['職業', '軟體工程師'],
    ['信用評級', '45'],
    ['理智', '55 / 55'],
    ['生命', '11'],
  ],
  attributes: [
    ['體能', '40'],
    ['靈巧', '50'],
    ['觀察', '60'],
    ['分析', '75'],
    ['應對', '50'],
    ['意志', '55'],
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
  clues: [
    {
      title: '淡淡的腥味',
      body: '入口樓梯間的潮濕氣味底下，似乎混著很淡的腥味。再次確認時，味道反而變得難以辨認。',
    },
    {
      title: '老舊信箱',
      body: '朋友住處對應的信箱沒有上鎖，裡面塞著廣告傳單與尚未取走的信件。',
    },
  ],
  items: ['筆記型電腦', '智慧型手機', '未完成的工作專案', '現金與悠遊卡'],
  logs: [
    '7月15日 00:30 抵達老公寓入口。',
    '地址與朋友傳來的位置相符。',
    '目前尚未進入樓梯間深處。',
  ],
} as const
