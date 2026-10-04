<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">维护整编成果，围绕成果编号、整编年份、站点编号、整编类型做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">登记整编成果</button>
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showCreate" class="filter-bar" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="createForm[field]" :placeholder="`填写${field}`" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无数据整编数据，可先登记整编成果</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">按整编年份 + 站点编号汇总（不含已驳回）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>整编年份</th>
          <th>站点编号</th>
          <th>成果数</th>
          <th>原始记录数合计</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in summary" :key="`${item.整编年份}-${item.站点编号}`">
          <td>{{ item.整编年份 }}</td>
          <td>{{ item.站点编号 }}</td>
          <td>{{ item.成果数 }}</td>
          <td>{{ item.原始记录数合计 }}</td>
        </tr>
        <tr v-if="!summary.length">
          <td colspan="4" class="empty-state">暂无有效整编成果，驳回的成果不计入汇总</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据整编记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  compilationSummary,
  createCompilation,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { CompilationSummaryRow } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = ["成果编号", "整编年份", "站点编号", "整编类型", "原始记录数", "整编人", "审核人", "整编状态"]
const actions = meta.actions
const statuses = ["待整编", "整编中", "待审核", "已刊印", "已驳回"]
const createFields = ["整编年份", "站点编号", "整编类型", "原始记录数", "整编人"]

const rows = ref<EntryRow[]>([])
const summary = ref<CompilationSummaryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const createForm = reactive<Record<string, string>>({
  整编年份: '',
  站点编号: '',
  整编类型: '',
  原始记录数: '',
  整编人: '',
})

const stats = computed(() => {
  const yearsOf = (status: string) =>
    new Set(rows.value.filter((row) => row.status === status).map((row) => String(row['整编年份']))).size
  return [
    { label: '待整编年度', value: yearsOf('待整编') },
    { label: '整编中年度', value: yearsOf('整编中') },
    { label: '已刊印成果', value: rows.value.filter((row) => row.status === '已刊印').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function toggleCreate() {
  showCreate.value = !showCreate.value
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createCompilation({
    整编年份: createForm.整编年份,
    站点编号: createForm.站点编号,
    整编类型: createForm.整编类型,
    原始记录数: createForm.原始记录数,
    整编人: createForm.整编人,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  showCreate.value = false
  for (const field of createFields) {
    createForm[field] = ''
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = compilationSummary(filters.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

onMounted(reload)
</script>
