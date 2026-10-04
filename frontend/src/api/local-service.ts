import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, freshRows, listRows, resetRows, saveRows, statusField } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SaveResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 驳回整编后在巡检模块挂一条复核记录：同一成果已有「待巡检」复核时沿用已有记录，
 * 即使同时提交也只留一条，不会重复生成第二个版本。
 */
function ensureInspectionReview(row: EntryRow): boolean {
  const key = 'inspection'
  const marker = String(row['成果编号'] ?? row.id)
  const rows = freshRows(key)
  const existing = rows.find(
    (item) =>
      item['检查项目'] === '整编成果复核' &&
      String(item['发现问题'] ?? '').includes(marker) &&
      item.status === '待巡检',
  )
  if (existing) {
    return false
  }
  const id = nextId(rows)
  const review: EntryRow = {
    id,
    status: '待巡检',
    pending: true,
    abnormal: false,
    记录编号: `INSP-${String(id).padStart(4, '0')}`,
    站点编号: String(row['站点编号'] ?? ''),
    巡检日期: new Date().toISOString().slice(0, 10),
    巡检人员: '待指派',
    检查项目: '整编成果复核',
    发现问题: `整编成果${marker}（${row['整编年份'] ?? ''}年）被驳回，需复核原始记录`,
    处理措施: '待复核',
  }
  saveRows(key, [...rows, review])
  return true
}

/** 动作落库后的联动：目前只有整编驳回 → 巡检模块生成复核记录。 */
function afterAction(key: string, action: string, row: EntryRow): string {
  if (key === 'compilation' && action === '驳回整编') {
    return ensureInspectionReview(row) ? '，已联动巡检生成复核记录' : '，巡检复核记录已存在，沿用已有记录'
  }
  return ''
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 写之前绕过缓存读最新快照：并发的另一次提交若已落到终态，这里能拦下来，只接受一个终态。
  const rows = freshRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const allowedFrom = meta.transitions?.[action]
  if (allowedFrom && !allowedFrom.includes(current)) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」不允许${action}` }
  }
  const finals = meta.finalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  const field = statusField(meta)
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    // 状态列字段同步写，列表和打印包里的「整编状态」与当前状态保持一致
    ...(field ? { [field]: target } : {}),
    pending: !finals.includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${afterAction(key, action, updated)}` }
}

export type CompilationInput = {
  整编年份: string
  站点编号: string
  整编类型: string
  原始记录数: string | number
  整编人: string
}

/**
 * 登记整编成果：按「整编年份 + 站点编号」幂等。
 * 已有记录（含旧驳回记录）直接沿用，不生成第二个版本，原处理人保留；
 * 驳回记录重新登记时回到「待整编」返工，即使同时提交也只命中同一条。
 */
export function createCompilation(input: CompilationInput): SaveResult {
  const key = 'compilation'
  const meta = moduleMeta(key)
  const year = input.整编年份.trim()
  const station = input.站点编号.trim()
  if (!year || !station) {
    return { ok: false, message: '整编年份和站点编号不能为空' }
  }
  const parsed = input.原始记录数 === '' ? NaN : Number(input.原始记录数)
  const rows = freshRows(key)
  const existing = rows.find(
    (row) => String(row['整编年份']) === year && String(row['站点编号']) === station,
  )
  if (existing) {
    const revived = String(existing.status) === '已驳回'
    const next = rows.map((row) => {
      if (Number(row.id) !== Number(existing.id)) {
        return row
      }
      const merged: EntryRow = {
        ...row,
        整编类型: input.整编类型.trim() || row['整编类型'],
        原始记录数: Number.isFinite(parsed) ? parsed : row['原始记录数'],
        整编人: input.整编人.trim() || row['整编人'],
      }
      if (revived) {
        merged.status = '待整编'
        merged.pending = true
        merged.abnormal = false
      }
      return merged
    })
    saveRows(key, next)
    return {
      ok: true,
      reused: true,
      id: Number(existing.id),
      message: revived
        ? `该年份与站点已有被驳回的整编成果，已沿用原记录（${existing['成果编号']}）回到待整编`
        : `该年份与站点已有整编成果，沿用已有记录（${existing['成果编号']}）`,
    }
  }
  const id = nextId(rows)
  const created: EntryRow = {
    id,
    status: '待整编',
    pending: true,
    abnormal: false,
    成果编号: `COMP-${String(id).padStart(4, '0')}`,
    整编年份: year,
    站点编号: station,
    整编类型: input.整编类型.trim() || '综合整编',
    原始记录数: Number.isFinite(parsed) ? parsed : 0,
    整编人: input.整编人.trim() || '待分配',
    审核人: '',
  }
  saveRows(key, [...rows, created])
  return { ok: true, id, message: `${meta.entity}已登记，编号 ${created['成果编号']}，当前状态「待整编」` }
}

export type CompilationSummaryRow = {
  整编年份: string
  站点编号: string
  成果数: number
  原始记录数合计: number
}

/** 按「整编年份 + 站点编号」汇总原始记录数：已驳回的成果不计入，驳回后不再残留。 */
export function compilationSummary(filters: Record<string, string> = {}): CompilationSummaryRow[] {
  const grouped = new Map<string, CompilationSummaryRow>()
  for (const row of filterRows(listRows('compilation'), filters)) {
    if (String(row.status) === '已驳回') {
      continue
    }
    const year = String(row['整编年份'] ?? '')
    const station = String(row['站点编号'] ?? '')
    const groupKey = `${year}::${station}`
    const count = Number(row['原始记录数'])
    const slot = grouped.get(groupKey) ?? { 整编年份: year, 站点编号: station, 成果数: 0, 原始记录数合计: 0 }
    slot.成果数 += 1
    slot.原始记录数合计 += Number.isFinite(count) ? count : 0
    grouped.set(groupKey, slot)
  }
  return [...grouped.values()].sort((a, b) =>
    `${a.整编年份}${a.站点编号}`.localeCompare(`${b.整编年份}${b.站点编号}`),
  )
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
