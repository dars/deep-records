// 系統旗標註冊表：server 邏輯與前端依賴的旗標唯一宣告處。
// tests/registry.test.ts 會掃描 worker/ 與 src/ 原始碼，
// 任何出現在程式碼裡、卻不在這份清單（或允許的命名空間）的旗標都會讓測試失敗——
// 防止跨模組字串漂移（曾發生 enum 漏列導致整條信念通道失效）。
//
// 模型在執行期可以自創旗標（setFlags 是開放宇宙），那不在本檔案管轄範圍；
// 這裡管的是「程式碼寫死的旗標」。

export const systemFlags = [
  // 阿陽登場與門外狀態機
  'officer_a_yang_arrived',
  'officer_wait_one',
  'officer_knock_escalated',
  'officer_door_opened',
  'officer_entered_with_key',
  'officer_player_restrained',
  'player_hiding',
  'officer_hidden_wait_one',
  'officer_found_hiding_player',
  'officer_stay_turn_1',
  'officer_stay_turn_2',
  'officer_stay_turn_3',
  'officer_stay_turn_4',
  'officer_stay_turn_5',
  'officer_escort_summons',

  // 五樓終局節奏
  'fifth_floor_turn_1',
  'fifth_floor_turn_2',
  'fifth_floor_turn_3',
  'ritual_forced_climax',

  // 場景進度里程碑（確定性腳本設定）
  'called_a_hong_no_answer',
  'friend_apartment_iron_door_opened',
  'friend_apartment_wooden_door_opened',
  'friend_apartment_spare_key_found',
  'hidden_memory_card_found',
  'living_room_table_drawer_noise_heard',
  'living_room_table_surface_examined',
  'living_room_table_hidden_space_suspected',
  'living_room_table_drawer_opened',
  'memory_card_initial_files_opened',
  'star_spawn_idol_examined',
] as const

export type SystemFlag = (typeof systemFlags)[number]

// 允許的開放命名空間：SAN 事件去重旗標由 sanity-rules.md 事件表與模型共同決定。
export const allowedFlagPrefixes = ['san_checked_'] as const

export function isKnownFlag(flag: string): boolean {
  return (
    (systemFlags as readonly string[]).includes(flag) ||
    allowedFlagPrefixes.some((prefix) => flag.startsWith(prefix))
  )
}
