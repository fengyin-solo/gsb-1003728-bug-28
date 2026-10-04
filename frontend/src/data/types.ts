/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 可选：动作允许的起始状态。登记了就校验来源状态，没登记保持任意状态可执行。 */
  transitions?: Record<string, string[]>
  /** 可选：终态集合（到了就不再算待办）。缺省取 statuses 的最后一个。 */
  finalStatuses?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type SaveResult = ActionResult & {
  /** 命中已有记录时为已有记录的 id（沿用，不生成第二个版本） */
  id?: number
  reused?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
