import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  applyReview,
  approveBatch,
  confirmBatchCheck,
  createBatch,
  getDashboardStats,
  invalidateStaleBatches,
  readDatabase,
  releaseBatch,
  revalidateBatch,
  rollbackBatch,
  rollbackFlag,
  writeDatabase,
} from '@/services/database'
import type {
  AuditEvent,
  CreateBatchInput,
  DashboardData,
  FeatureFlag,
  FlagFilter,
  ImpactIssue,
  ReleaseBatch,
  ReviewPayload,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const toError = (error: unknown, fallback: string) => ({
  message: error instanceof Error ? error.message : fallback,
})

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard', 'Batches'],
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
        invalidateStaleBatches(db)
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
        { type: 'Flag', id: arg.id },
      ],
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
    getBatches: builder.query<ReleaseBatch[], void>({
      async queryFn() {
        await delay()
        return { data: readDatabase().batches }
      },
      providesTags: ['Batches'],
    }),
    createBatch: builder.mutation<ReleaseBatch, CreateBatchInput>({
      async queryFn(input) {
        await delay(260)
        try {
          return { data: createBatch(input) }
        } catch (error) {
          return { error: toError(error, '创建批次失败') }
        }
      },
      invalidatesTags: ['Batches', 'Audit'],
    }),
    approveBatch: builder.mutation<
      ReleaseBatch,
      { id: string; actor: string; expectedRevision: number }
    >({
      async queryFn({ id, actor, expectedRevision }) {
        await delay(260)
        try {
          return { data: approveBatch(id, actor, expectedRevision) }
        } catch (error) {
          return { error: toError(error, '批准批次失败') }
        }
      },
      invalidatesTags: ['Batches', 'Audit'],
    }),
    revalidateBatch: builder.mutation<ReleaseBatch, { id: string }>({
      async queryFn({ id }) {
        await delay(220)
        try {
          return { data: revalidateBatch(id) }
        } catch (error) {
          return { error: toError(error, '重新校验失败') }
        }
      },
      invalidatesTags: ['Batches'],
    }),
    confirmBatchCheck: builder.mutation<ReleaseBatch, { id: string; checkId: string }>({
      async queryFn({ id, checkId }) {
        await delay(220)
        try {
          return { data: confirmBatchCheck(id, checkId) }
        } catch (error) {
          return { error: toError(error, '确认检查项失败') }
        }
      },
      invalidatesTags: ['Batches'],
    }),
    releaseBatch: builder.mutation<
      ReleaseBatch,
      { id: string; actor: string; expectedRevision: number }
    >({
      async queryFn({ id, actor, expectedRevision }) {
        await delay(300)
        try {
          return { data: releaseBatch(id, actor, expectedRevision) }
        } catch (error) {
          return { error: toError(error, '发布批次失败') }
        }
      },
      invalidatesTags: ['Batches', 'Flags', 'Flag', 'Audit', 'Dashboard'],
    }),
    rollbackBatch: builder.mutation<ReleaseBatch, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        await delay(300)
        try {
          return { data: rollbackBatch(id, actor, reason) }
        } catch (error) {
          return { error: toError(error, '批次回滚失败') }
        }
      },
      invalidatesTags: ['Batches', 'Flags', 'Flag', 'Audit', 'Dashboard'],
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
  useCreateBatchMutation,
  useApproveBatchMutation,
  useRevalidateBatchMutation,
  useConfirmBatchCheckMutation,
  useReleaseBatchMutation,
  useRollbackBatchMutation,
} = flagApi
