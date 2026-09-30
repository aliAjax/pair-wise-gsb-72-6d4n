import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  applyReview,
  getDashboardStats,
  readDatabase,
  rollbackFlag,
  writeDatabase,
} from '@/services/database'
import {
  alignRolloutOrder,
  confirmBatchEnv,
  createBatch,
  dualApprove,
  getBatch,
  getBatchLiveViews,
  invalidateBatchesForKey,
  listBatches,
  publishBatch,
  rebuildBatch,
  resolveDependency,
  revalidateBatch,
  rollbackBatch,
  simulateEnvChange,
  syncClientBaseline,
} from '@/services/batches'
import type {
  AuditEvent,
  CreateBatchPayload,
  DashboardData,
  EnvRuntimeState,
  FeatureFlag,
  FlagFilter,
  ImpactIssue,
  ReleaseBatch,
  ReviewPayload,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard', 'Batches', 'Batch'],
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardData, void>({
      async queryFn() {
        await delay()
        return { data: getDashboardStats() }
      },
      providesTags: ['Dashboard'],
    }),
    getFlags: builder.query<FeatureFlag[], FlagFilter>({
      async queryFn(filters) {
        await delay()
        const keyword = filters.keyword?.trim().toLowerCase()
        const data = readDatabase().flags.filter(
          (flag) =>
            (!filters.status || flag.status === filters.status) &&
            (!filters.environment || flag.environment === filters.environment) &&
            (!filters.team || flag.team === filters.team) &&
            (!filters.owner || flag.owner === filters.owner) &&
            (!keyword ||
              flag.name.toLowerCase().includes(keyword) ||
              flag.key.toLowerCase().includes(keyword) ||
              flag.owner.toLowerCase().includes(keyword)),
        )
        return { data }
      },
      providesTags: ['Flags'],
    }),
    getFlag: builder.query<FeatureFlag, string>({
      async queryFn(id) {
        await delay()
        const flag = readDatabase().flags.find((item) => item.id === id)
        return flag ? { data: flag } : { error: { message: '功能开关不存在' } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Flag', id }],
    }),
    saveFlag: builder.mutation<FeatureFlag, FeatureFlag>({
      async queryFn(flag) {
        await delay(260)
        const db = readDatabase()
        const index = db.flags.findIndex((item) => item.id === flag.id)
        const next = { ...flag, updatedAt: new Date().toISOString() }
        if (index >= 0) {
          const before = db.flags[index]
          db.flags[index] = next
          db.audit.unshift({
            id: `audit-${Date.now()}`,
            flagId: flag.id,
            flagKey: flag.key,
            action: 'updated',
            actor: flag.lastChangedBy,
            summary: '更新开关受众、依赖、版本或回滚条件。',
            before: before.status,
            after: next.status,
            affectedUsers: Math.round(900000 * (next.rolloutPercentage / 100)),
            createdAt: new Date().toISOString(),
          })
        } else {
          db.flags.unshift(next)
          db.audit.unshift({
            id: `audit-${Date.now()}`,
            flagId: next.id,
            flagKey: next.key,
            action: 'created',
            actor: next.lastChangedBy,
            summary: '创建功能开关草稿。',
            after: next.status,
            affectedUsers: 0,
            createdAt: new Date().toISOString(),
          })
        }
        // 来源环境/依赖/版本/灰度阶段被改动：批准中的同 Key 候选立即失效
        invalidateBatchesForKey(db, next.key, next.lastChangedBy)
        writeDatabase(db)
        return { data: next }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit', 'Batches'],
    }),
    submitForReview: builder.mutation<FeatureFlag, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(220)
        const db = readDatabase()
        const flag = db.flags.find((item) => item.id === id)
        if (!flag) return { error: { message: '功能开关不存在' } }
        flag.status = 'review'
        flag.updatedAt = new Date().toISOString()
        flag.lastChangedBy = actor
        db.audit.unshift({
          id: `audit-${Date.now()}`,
          flagId: id,
          flagKey: flag.key,
          action: 'submitted',
          actor,
          summary: '提交发布影响评审。',
          before: 'draft',
          after: 'review',
          affectedUsers: Math.round(900000 * (flag.rolloutPercentage / 100)),
          createdAt: new Date().toISOString(),
        })
        writeDatabase(db)
        return { data: flag }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        'Batches',
        { type: 'Flag', id: arg.id },
      ],
    }),
    reviewFlag: builder.mutation<FeatureFlag, { id: string; payload: ReviewPayload }>({
      async queryFn({ id, payload }) {
        await delay(260)
        try {
          return { data: applyReview(id, payload) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '审批失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        'Batches',
        { type: 'Flag', id: arg.id },
      ],
    }),
    rollbackFlag: builder.mutation<FeatureFlag, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        await delay(260)
        try {
          return { data: rollbackFlag(id, actor, reason) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '回滚失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        'Batches',
        { type: 'Flag', id: arg.id },
      ],
    }),
    getBatches: builder.query<ReleaseBatch[], void>({
      async queryFn() {
        await delay()
        return { data: listBatches() }
      },
      providesTags: ['Batches'],
    }),
    getBatchDetail: builder.query<{ batch: ReleaseBatch; live: EnvRuntimeState[] }, string>({
      async queryFn(id) {
        await delay()
        const batch = getBatch(id)
        if (!batch) return { error: { message: '批次不存在' } }
        return { data: { batch, live: getBatchLiveViews(batch) } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Batch', id }, 'Batches'],
    }),
    createBatch: builder.mutation<ReleaseBatch, CreateBatchPayload>({
      async queryFn(payload) {
        await delay(260)
        try {
          return { data: createBatch(payload) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '创建批次失败' } }
        }
      },
      invalidatesTags: ['Batches', 'Audit'],
    }),
    confirmBatch: builder.mutation<ReleaseBatch, { id: string; env: CreateBatchPayload['sourceEnv']; actor: string; comment?: string }>({
      async queryFn(payload) {
        await delay(220)
        try {
          return { data: confirmBatchEnv(payload.id, payload.env, payload.actor, payload.comment) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '批准失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    dualApproveBatch: builder.mutation<{ winner: ReleaseBatch; loser: ReleaseBatch }, { actor: string }>({
      async queryFn({ actor }) {
        await delay(260)
        try {
          return { data: dualApprove(actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '双窗口裁决失败' } }
        }
      },
      invalidatesTags: ['Batches', 'Audit'],
    }),
    revalidateBatch: builder.mutation<ReleaseBatch, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(220)
        try {
          return { data: revalidateBatch(id, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '重新校验失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    resolveDependencyBlocker: builder.mutation<ReleaseBatch, { id: string; blockerId: string; actor: string }>({
      async queryFn({ id, blockerId, actor }) {
        await delay(220)
        try {
          return { data: resolveDependency(id, blockerId, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '修复失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Flags', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    syncBaselineBlocker: builder.mutation<ReleaseBatch, { id: string; blockerId: string; actor: string }>({
      async queryFn({ id, blockerId, actor }) {
        await delay(220)
        try {
          return { data: syncClientBaseline(id, blockerId, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '同步基线失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    alignOrderBlocker: builder.mutation<ReleaseBatch, { id: string; blockerId: string; actor: string }>({
      async queryFn({ id, blockerId, actor }) {
        await delay(220)
        try {
          return { data: alignRolloutOrder(id, blockerId, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '对齐灰度失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Flags', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    publishBatch: builder.mutation<ReleaseBatch, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(300)
        try {
          return { data: publishBatch(id, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '发布失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Flags', 'Dashboard', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    rollbackBatch: builder.mutation<ReleaseBatch, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        await delay(300)
        try {
          return { data: rollbackBatch(id, actor, reason) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '整批回滚失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Flags', 'Dashboard', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    rebuildBatch: builder.mutation<ReleaseBatch, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(260)
        try {
          return { data: rebuildBatch(id, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '重建批次失败' } }
        }
      },
      invalidatesTags: ['Batches', 'Audit'],
    }),
    simulateEnvChange: builder.mutation<ReleaseBatch, { id: string; env: CreateBatchPayload['sourceEnv']; actor: string }>({
      async queryFn({ id, env, actor }) {
        await delay(200)
        try {
          return { data: simulateEnvChange(id, env, actor) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '模拟改动失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => ['Batches', 'Flags', 'Audit', { type: 'Batch', id: arg.id }],
    }),
    getIssues: builder.query<ImpactIssue[], { category?: string; resolved?: boolean }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().issues.filter(
          (issue) =>
            (!filters.category || issue.category === filters.category) &&
            (filters.resolved === undefined || issue.resolved === filters.resolved),
        )
        return { data }
      },
      providesTags: ['Issues'],
    }),
    getAudit: builder.query<AuditEvent[], { flagId?: string; action?: string }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().audit.filter(
          (event) =>
            (!filters.flagId || event.flagId === filters.flagId) &&
            (!filters.action || event.action === filters.action),
        )
        return { data }
      },
      providesTags: ['Audit'],
    }),
  }),
})

export const {
  useGetDashboardQuery,
  useGetFlagsQuery,
  useGetFlagQuery,
  useSaveFlagMutation,
  useSubmitForReviewMutation,
  useReviewFlagMutation,
  useRollbackFlagMutation,
  useGetIssuesQuery,
  useGetAuditQuery,
  useGetBatchesQuery,
  useGetBatchDetailQuery,
  useCreateBatchMutation,
  useConfirmBatchMutation,
  useDualApproveBatchMutation,
  useRevalidateBatchMutation,
  useResolveDependencyBlockerMutation,
  useSyncBaselineBlockerMutation,
  useAlignOrderBlockerMutation,
  usePublishBatchMutation,
  useRollbackBatchMutation,
  useRebuildBatchMutation,
  useSimulateEnvChangeMutation,
} = flagApi
