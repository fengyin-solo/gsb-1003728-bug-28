// 行为验证：整编数据流（共享状态 / 列表与打印包一致 / 汇总剔除驳回 / 联动复核 / 并发终态）
// 用 esbuild 打包后在 node 里跑：window/localStorage 先打桩，再动态 import 服务层。

const store = new Map<string, string>()
const listeners = new Map<string, ((event: { key: string }) => void)[]>()

;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  },
  addEventListener: (type: string, fn: (event: { key: string }) => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn])
  },
}

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const scenario = process.argv[2] ?? 'main'

if (scenario === 'legacy') {
  // 旧版本留下的驳回记录：status 已驳回，但整编状态字段还是旧的「待审核」，pending 缺失
  store.set(
    'hydrology-monitor-station:entries',
    JSON.stringify({
      compilation: [
        {
          id: 9,
          status: '已驳回',
          成果编号: 'COMP-0009',
          整编年份: '2023',
          站点编号: 'STAT-0002',
          整编类型: '水位流量年鉴',
          原始记录数: 500,
          整编人: '旧处理人',
          审核人: '旧审核',
          整编状态: '待审核',
        },
      ],
    }),
  )
}

const service = await import('../src/api/local-service')

if (scenario === 'legacy') {
  const rows = service.listEntries('compilation').items
  const legacy = rows.find((r) => Number(r.id) === 9)
  check('旧驳回记录状态字段被回填为已驳回', legacy?.['整编状态'] === '已驳回', legacy)
  check('旧驳回记录不进汇总', !service.compilationSummary().some((g) => g.整编年份 === '2023'))
  const persisted = JSON.parse(store.get('hydrology-monitor-station:entries')!)
  check(
    '迁移结果已落盘',
    persisted.compilation.find((r: { id: number }) => r.id === 9)['整编状态'] === '已驳回',
  )
  // 旧记录可以直接再提交，沿用原记录
  const resubmit = service.runAction('compilation', 9, '提交审核')
  check('旧驳回记录直接再提交成功', resubmit.ok, resubmit)
  const after = service.listEntries('compilation').items.filter((r) => Number(r.id) === 9)
  check('再提交后仍只有一条记录', after.length === 1 && after[0].status === '待审核', after)
  check('再提交后整编人保留', after[0]['整编人'] === '旧处理人', after[0])
} else {
  // —— 列表与打印包状态一致 ——
  const start = service.runAction('compilation', 1, '开始整编')
  check('开始整编成功', start.ok, start)
  const row1 = service.listEntries('compilation').items.find((r) => Number(r.id) === 1)!
  check('列表两列状态一致', row1.status === '整编中' && row1['整编状态'] === '整编中', row1)
  const csv = service.exportEntries('compilation').content
  const line1 = csv.split('\n').find((l) => l.startsWith('1,'))!
  check('打印包状态字段与当前状态一致', /,整编中,整编中$/.test(line1), line1)

  // —— 状态机守卫：并发/乱序只收敛一个终态 ——
  const bad = service.runAction('compilation', 1, '确认刊印')
  check('整编中不能直接刊印', !bad.ok, bad)
  const dup = service.runAction('compilation', 1, '开始整编')
  check('重复动作被拒绝（幂等）', !dup.ok, dup)

  // —— 汇总：驳回后原始记录数不残留 ——
  const before = service.compilationSummary()
  const g1 = before.find((g) => g.整编年份 === '2025' && g.站点编号 === 'STAT-0002')!
  check('驳回前汇总含整编中成果', g1.原始记录数 === 964, g1)
  service.runAction('compilation', 2, '提交审核')
  const reject = service.runAction('compilation', 2, '驳回整编')
  check('驳回成功', reject.ok, reject)
  const after = service.compilationSummary()
  check(
    '驳回后该年份+站点不再残留',
    !after.some((g) => g.整编年份 === '2025' && g.站点编号 === 'STAT-0002'),
    after,
  )
  check(
    '种子里的已驳回成果（COMP-0005）不计入汇总',
    after.find((g) => g.整编年份 === '2025' && g.站点编号 === 'STAT-0001')!.原始记录数 === 1280,
    after,
  )

  // —— 驳回后直接再提交：沿用原记录，不生成第二个版本 ——
  const totalBefore = service.listEntries('compilation').total
  const resubmit = service.runAction('compilation', 2, '提交审核')
  check('已驳回可直接再提交', resubmit.ok, resubmit)
  const totalAfter = service.listEntries('compilation').total
  check('再提交不产生新记录', totalBefore === totalAfter, { totalBefore, totalAfter })
  const row2 = service.listEntries('compilation').items.find((r) => Number(r.id) === 2)!
  check('再提交后状态与字段同步', row2.status === '待审核' && row2['整编状态'] === '待审核', row2)
  check('再提交后整编人不变', row2['整编人'] === '张楚', row2)

  // —— 登记：同一业务键只留一条处理记录，同时提交也沿用已有记录 ——
  const created = service.registerEntry('compilation', {
    整编年份: '2026',
    站点编号: 'STAT-0001',
    整编类型: '水位流量年鉴',
    原始记录数: 100,
    整编人: '张楚',
    审核人: '李审',
  })
  check('新登记成功', created.ok && !created.reused, created)
  const again = service.registerEntry('compilation', {
    整编年份: '2026',
    站点编号: 'STAT-0001',
    整编类型: '水位流量年鉴',
    原始记录数: 999,
    整编人: '别人',
    审核人: '别人',
  })
  check('同时提交沿用已有记录', again.ok && again.reused === true && again.id === created.id, again)
  const rows2026 = service
    .listEntries('compilation')
    .items.filter((r) => String(r['整编年份']) === '2026')
  check('业务键只留一条记录', rows2026.length === 1 && Number(rows2026[0]['原始记录数']) === 100, rows2026)

  // —— 巡检联动：源数据流转后同站点整编成果生成复核 ——
  const link = service.runAction('inspection', 1, '完成巡检') // 站点 STAT-0001
  check('巡检动作成功且提示联动', link.ok && link.message.includes('待复核'), link)
  const row3 = service.listEntries('compilation').items.find((r) => Number(r.id) === 3)!
  check('同站点待审核成果转入待复核', row3.status === '待复核' && row3['整编状态'] === '待复核', row3)
  const row4a = service.listEntries('compilation').items.find((r) => Number(r.id) === 4)!
  check('其他站点成果不受影响', row4a.status === '已刊印', row4a)
  service.runAction('inspection', 3, '确认处置') // 站点 STAT-0003
  const row4b = service.listEntries('compilation').items.find((r) => Number(r.id) === 4)!
  check('已刊印成果也被联动复核', row4b.status === '待复核', row4b)
  const review = service.runAction('compilation', 4, '完成复核')
  check('完成复核回到待审核', review.ok, review)
  const stats = service.compilationStats()
  check('统计卡按真实数据计算', stats.find((s) => s.label === '已刊印成果')!.value === 0, stats)

  // —— 跨标签页：另一个标签写入后，本地快照失效、基于最新数据收敛 ——
  const external = JSON.parse(store.get('hydrology-monitor-station:entries')!)
  external.compilation.find((r: { id: number }) => r.id === 1).status = '待审核'
  store.set('hydrology-monitor-station:entries', JSON.stringify(external))
  for (const fn of listeners.get('storage') ?? []) fn({ key: 'hydrology-monitor-station:entries' })
  const late = service.runAction('compilation', 1, '开始整编')
  check('基于过期快照的流转被拒绝', !late.ok, late)
  const final1 = service.listEntries('compilation').items.find((r) => Number(r.id) === 1)!
  check('终态唯一', final1.status === '待审核', final1)
}

if (failures > 0) {
  console.log(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
