import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, updateRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RegisterResult,
  SummaryGroup,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 整编成果的状态机：只接受登记过的流转，并发操作也只收敛到一个终态。
// 驳回后允许直接「提交审核」再走一遍：沿用原记录，不另起新版本。
const COMPILATION_FLOW: Record<string, string[]> = {
  开始整编: ['待整编'],
  提交审核: ['整编中', '已驳回'],
  确认刊印: ['待审核'],
  驳回整编: ['整编中', '待审核', '待复核'],
  完成复核: ['待复核'],
}

// 整编成果的业务键：同一整编年份 + 站点编号 + 整编类型只留一条处理记录。
const COMPILATION_KEY_FIELDS = ['整编年份', '站点编号', '整编类型']

// 源数据模块流转后，同站点处于这些状态的整编成果会被联动置为待复核。
const REVIEW_LINK_STATUSES = ['待审核', '已刊印']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function statusFieldOf(meta: ModuleMeta): string | null {
  return meta.fields.length > 0 ? meta.fields[meta.fields.length - 1] : null
}

function isTerminal(meta: ModuleMeta, status: string): boolean {
  if (meta.terminalStatuses && meta.terminalStatuses.length > 0) {
    return meta.terminalStatuses.includes(status)
  }
  return status === meta.statuses[meta.statuses.length - 1]
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

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const statusField = statusFieldOf(meta)
  let result: ActionResult = { ok: false, message: '' }
  // updateRows 内部先重读持久化状态再改再写：同时提交的两个动作按顺序收敛，
  // 后到的动作基于最新状态判断，只留一个终态。
  updateRows(key, (rows) => {
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      result = { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
      return rows
    }
    const current = String(rows[index].status)
    if (current === target) {
      result = { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
      return rows
    }
    const allowedFrom = key === 'compilation' ? COMPILATION_FLOW[action] : undefined
    if (allowedFrom && !allowedFrom.includes(current)) {
      result = { ok: false, message: `${meta.entity}当前状态「${current}」，不能${action}` }
      return rows
    }
    const updated: EntryRow = {
      ...rows[index],
      status: target,
      pending: !isTerminal(meta, target),
      abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    }
    // 状态字段（整编状态等）跟着 status 一起走，列表和打印包不再两列对不上
    if (statusField) {
      updated[statusField] = target
    }
    const next = [...rows]
    next[index] = updated
    result = { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
    return next
  })
  if (result.ok && key !== 'compilation') {
    const linked = linkCompilationReview(key, id)
    if (linked > 0) {
      result = { ...result, message: `${result.message}；已联动 ${linked} 条整编成果转入待复核` }
    }
  }
  return result
}

// 巡检等源数据模块流转后，同站点已进入审核/刊印阶段的整编成果联动生成复核。
function linkCompilationReview(sourceKey: string, sourceId: number): number {
  const source = listRows(sourceKey).find((row) => Number(row.id) === sourceId)
  const station = source?.['站点编号']
  if (station === undefined || station === '') {
    return 0
  }
  let linked = 0
  updateRows('compilation', (rows) =>
    rows.map((row) => {
      if (String(row['站点编号']) !== String(station)) {
        return row
      }
      if (!REVIEW_LINK_STATUSES.includes(String(row.status))) {
        return row
      }
      linked += 1
      return { ...row, status: '待复核', pending: true, 整编状态: '待复核' }
    }),
  )
  return linked
}

export function registerEntry(key: string, values: Record<string, string | number>): RegisterResult {
  const meta = moduleMeta(key)
  const statusField = statusFieldOf(meta)
  let result: RegisterResult = { ok: false, message: '' }
  updateRows(key, (rows) => {
    if (key === 'compilation') {
      // 同一业务键只留一条处理记录：即使同时提交，也沿用已有记录，不生成第二个版本
      const existing = rows.find((row) =>
        COMPILATION_KEY_FIELDS.every(
          (field) => String(row[field] ?? '') === String(values[field] ?? ''),
        ),
      )
      if (existing) {
        result = {
          ok: true,
          reused: true,
          id: Number(existing.id),
          message: `${meta.entity}已存在（${String(existing[meta.fields[0]] ?? existing.id)}，当前状态「${String(existing.status)}」），沿用已有记录`,
        }
        return rows
      }
    }
    const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const status = meta.statuses[0] ?? ''
    const entry: EntryRow = { id, status, pending: true, abnormal: false }
    for (const field of meta.fields) {
      entry[field] = values[field] ?? ''
    }
    const codeField = meta.fields[0]
    if (codeField && !values[codeField]) {
      entry[codeField] = `${codePrefixOf(key, rows, codeField)}-${String(id).padStart(4, '0')}`
    }
    if (statusField) {
      entry[statusField] = status
    }
    result = { ok: true, id, message: `${meta.entity}已登记，当前状态「${status}」` }
    return [...rows, entry]
  })
  return result
}

function codePrefixOf(key: string, rows: EntryRow[], codeField: string): string {
  for (const row of rows) {
    const matched = /^([A-Za-z]+)-\d+$/.exec(String(row[codeField] ?? ''))
    if (matched) {
      return matched[1]
    }
  }
  return key.slice(0, 4).toUpperCase()
}

// 统计卡：按当前真实数据计算，已驳回的成果不计入任何汇总。
export function compilationStats(): { label: string; value: number }[] {
  const rows = listRows('compilation')
  const countStatus = (status: string) => rows.filter((row) => String(row.status) === status).length
  const countYears = (status: string) =>
    new Set(
      rows
        .filter((row) => String(row.status) === status)
        .map((row) => String(row['整编年份'] ?? '')),
    ).size
  return [
    { label: '待整编年度', value: countYears('待整编') },
    { label: '整编中年度', value: countYears('整编中') },
    { label: '已刊印成果', value: countStatus('已刊印') },
    { label: '待复核成果', value: countStatus('待复核') },
  ]
}

// 按整编年份 + 站点编号汇总原始记录数：已驳回的成果不残留进汇总。
export function compilationSummary(): SummaryGroup[] {
  const groups = new Map<string, SummaryGroup>()
  for (const row of listRows('compilation')) {
    if (String(row.status) === '已驳回') {
      continue
    }
    const year = String(row['整编年份'] ?? '')
    const station = String(row['站点编号'] ?? '')
    const key = `${year}::${station}`
    const group = groups.get(key) ?? { key, 整编年份: year, 站点编号: station, 成果数: 0, 原始记录数: 0 }
    group.成果数 += 1
    group.原始记录数 += Number(row['原始记录数']) || 0
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 打印包（导出清单）：状态字段与当前状态已在流转时同步，两列始终一致。
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
