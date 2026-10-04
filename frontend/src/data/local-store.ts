import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 每个模块的最后一个字段都是状态字段（整编状态、记录状态……）。
// 历史版本流转时只改 status、不回写状态字段，旧数据里两列对不上；
// 读取时统一以 status 为准回填状态字段，旧驳回记录自动兼容。
function statusFieldOf(key: string): string | null {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta || meta.fields.length === 0) {
    return null
  }
  return meta.fields[meta.fields.length - 1]
}

function normalizeRows(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  const statusField = statusFieldOf(key)
  const fallbackStatus = meta?.statuses[0] ?? ''
  return rows.map((row) => {
    const status = typeof row.status === 'string' && row.status !== '' ? row.status : fallbackStatus
    const next: EntryRow = {
      ...row,
      status,
      pending: Boolean(row.pending),
      abnormal: Boolean(row.abnormal),
    }
    if (statusField) {
      next[statusField] = status
    }
    return next
  })
}

function normalizeAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(data)) {
    next[key] = normalizeRows(key, Array.isArray(rows) ? rows : [])
  }
  return next
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = normalizeAll(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 迁移旧数据：状态字段回填后落盘，之后读到的一直是干净数据
    const merged = normalizeAll({ ...fallback, ...parsed })
    persist(merged)
    return merged
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

// 别的标签页写入时丢掉本地快照，下次操作基于最新数据，避免互相覆盖
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
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

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: normalizeRows(key, rows) }
  cache = next
  persist(next)
}

// 读-改-写一步完成：写前重读持久化状态，并发/同时提交时以最新数据为准，
// 同一个请求只收敛出一个终态，不留重复的处理记录。
export function updateRows(key: string, updater: (rows: EntryRow[]) => EntryRow[]): EntryRow[] {
  const fresh = readStorage()
  const nextRows = normalizeRows(key, updater(fresh[key] ?? []))
  const next = { ...fresh, [key]: nextRows }
  cache = next
  persist(next)
  return nextRows
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
