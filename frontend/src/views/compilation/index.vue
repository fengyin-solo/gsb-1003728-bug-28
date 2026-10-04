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

    <form v-if="showCreate" class="create-form" @submit.prevent="submitCreate">
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

    <section class="summary-block">
      <h3 class="summary-title">按整编年份与站点编号汇总（已驳回成果不计入）</h3>
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
          <tr v-for="group in summary" :key="group.key">
            <td>{{ group.整编年份 }}</td>
            <td>{{ group.站点编号 }}</td>
            <td>{{ group.成果数 }}</td>
            <td>{{ group.原始记录数 }}</td>
          </tr>
          <tr v-if="!summary.length">
            <td colspan="4" class="empty-state">暂无有效整编成果</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据整编记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  compilationStats,
  compilationSummary,
  downloadEntries,
  listEntries,
  moduleMeta,
  registerEntry,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, SummaryGroup } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const summary = ref<SummaryGroup[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const createFields = ['整编年份', '站点编号', '整编类型', '原始记录数', '整编人', '审核人']
const createForm = ref<Record<string, string>>({})
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
  if (!showCreate.value) {
    createForm.value = {}
  }
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const required = ['整编年份', '站点编号', '整编类型']
  const missing = required.filter((field) => !(createForm.value[field] ?? '').trim())
  if (missing.length > 0) {
    errorMessage.value = `请先填写${missing.join('、')}`
    return
  }
  const rawCount = String(createForm.value['原始记录数'] ?? '').trim()
  const recordCount = rawCount === '' ? 0 : Number(rawCount)
  if (Number.isNaN(recordCount)) {
    errorMessage.value = '原始记录数请填写数字'
    return
  }
  const result = registerEntry(meta.key, { ...createForm.value, 原始记录数: recordCount })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  showCreate.value = false
  createForm.value = {}
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
    stats.value = compilationStats()
    summary.value = compilationSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

onMounted(reload)
</script>
