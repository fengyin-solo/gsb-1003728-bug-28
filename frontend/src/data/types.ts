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
  /** 终态状态：落入这些状态后 pending 置 false；缺省取状态列表最后一项 */
  terminalStatuses?: string[]
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

export type RegisterResult = ActionResult & {
  /** 落库（或沿用）的记录编号 */
  id?: number
  /** 业务键已存在时复用原记录，不另起新版本 */
  reused?: boolean
}

/** 整编成果按整编年份 + 站点编号汇总的一行 */
export type SummaryGroup = {
  key: string
  整编年份: string
  站点编号: string
  成果数: number
  原始记录数: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
