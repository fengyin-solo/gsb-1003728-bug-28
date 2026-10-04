import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 模块里承担「状态列」的字段：约定是 fields 里最后一个以“状态”结尾的字段（如整编状态）。 */
export function statusField(meta: ModuleMeta): string | undefined {
  for (let index = meta.fields.length - 1; index >= 0; index -= 1) {
    if (meta.fields[index].endsWith('状态')) {
      return meta.fields[index]
    }
  }
  return undefined
}

/**
 * 规整一行记录：
 * - 状态列字段与 row.status 对齐（列表、打印包里的「整编状态」不再和当前状态打架）；
 * - 登记了终态集合的模块按终态重算 pending，旧驳回记录重新算作待处理。
 * 旧数据在读取时就会被规整，不需要手工迁移。
 */
function normalizeRow(meta: ModuleMeta, row: EntryRow): EntryRow {
  const next: EntryRow = { ...row, pending: Boolean(row.pending), abnormal: Boolean(row.abnormal) }
  const field = statusField(meta)
  if (field) {
    next[field] = String(next.status)
  }
  if (meta.finalStatuses) {
    next.pending = !meta.finalStatuses.includes(String(next.status))
  }
  return next
}

function normalizeRows(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return rows
  }
  return rows.map((row) => normalizeRow(meta, row))
}

function normalizeAll(value: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(value)) {
    next[key] = normalizeRows(key, rows)
  }
  return next
}

// window 不可用（测试脚本、SSR）时的兜底存储，行为与 localStorage 对齐。
let memoryStore: string | null = null

function readRaw(): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(STORAGE_KEY)
  }
  return memoryStore
}

function writeRaw(value: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, value)
  } else {
    memoryStore = value
  }
}

function persist(value: Record<string, EntryRow[]>): void {
  writeRaw(JSON.stringify(value))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  const raw = readRaw()
  if (!raw) {
    const seeded = normalizeAll(fallback)
    persist(seeded)
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return normalizeAll({ ...fallback, ...parsed })
  } catch {
    const seeded = normalizeAll(fallback)
    persist(seeded)
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

// 别的页签写了存储就丢掉本地缓存，下次读取拿最新快照，避免列表停在旧版本上。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 绕过内存缓存直接读存储：写操作前一律用它，并发提交时不会被旧快照骗到。 */
export function freshRows(key: string): EntryRow[] {
  const stored = readStorage()
  cache = stored
  return stored[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 以存储里的最新快照为底合并写入，避免整包覆盖掉别的页签刚写的其他模块。
  const next = { ...readStorage(), [key]: normalizeRows(key, rows) }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
