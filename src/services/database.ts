import type {
  AuditEvent,
  BatchCheckItem,
  BatchEnvSnapshot,
  CreateBatchInput,
  DashboardData,
  Environment,
  FeatureFlag,
  ImpactIssue,
  ReleaseBatch,
  ReviewPayload,
} from '@/types'
import { environmentLabels } from '@/types'

const STORAGE_KEY = 'feature-flag-release-console-v1'

export interface Database {
  flags: FeatureFlag[]
  audit: AuditEvent[]
  issues: ImpactIssue[]
  batches: ReleaseBatch[]
}

const flags: FeatureFlag[] = [
  {
    id: 'flag-101',
    key: 'checkout.express-pay-v2',
    name: '极速支付流程 V2',
    description: '在结算页启用新的地址确认和支付聚合流程。',
    owner: '陈思远',
    team: '交易体验',
    status: 'review',
    environment: 'staging',
    enabled: false,
    rolloutPercentage: 20,
    audienceRules: [
      { id: 'r-101-1', attribute: 'user.tier', operator: 'in', value: 'gold,platinum', negate: false },
      { id: 'r-101-2', attribute: 'client.platform', operator: 'equals', value: 'ios', negate: false },
      { id: 'r-101-3', attribute: 'account.risk_score', operator: 'lte', value: '40', negate: false },
    ],
    regions: ['CN-EAST', 'CN-SOUTH'],
    minClientVersion: { dev: '8.18.0', staging: '8.18.0', production: '8.18.0' },
    dependencies: [
      { flagId: 'flag-104', type: 'requires', condition: '支付聚合服务已启用' },
      { flagId: 'flag-108', type: 'conflicts', condition: '旧版优惠券浮层不可同时启用' },
    ],
    rollbackConditions: ['支付成功率 5 分钟低于 96%', 'P95 延迟高于 2200ms', '错误率高于 1.2%'],
    metricNames: ['checkout_payment_success_rate', 'checkout_p95_latency'],
    deadCodeStatus: 'candidate',
    rolloutSteps: [
      { id: 's-1', percentage: 1, audience: '内部体验账号', startedAt: '2026-09-25T10:00:00+08:00', status: 'completed', guardrails: ['无阻断错误'] },
      { id: 's-2', percentage: 5, audience: '华东区金卡用户', startedAt: '2026-09-27T14:30:00+08:00', status: 'completed', guardrails: ['支付成功率 > 97%'] },
      { id: 's-3', percentage: 20, audience: 'iOS 金卡及铂金用户', startedAt: '2026-09-29T09:00:00+08:00', status: 'running', guardrails: ['错误率 < 1.2%', 'P95 < 2200ms'] },
      { id: 's-4', percentage: 50, audience: '全量高价值用户', startedAt: '2026-10-02T10:00:00+08:00', status: 'planned', guardrails: ['人工审批'] },
    ],
    createdAt: '2026-09-12T14:20:00+08:00',
    updatedAt: '2026-09-29T09:05:00+08:00',
    lastChangedBy: '陈思远',
  },
  {
    id: 'flag-102',
    key: 'catalog.smart-recommendation',
    name: '商品智能推荐位',
    description: '基于实时意图在商品列表插入推荐模块。',
    owner: '许薇',
    team: '增长算法',
    status: 'active',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 35,
    audienceRules: [
      { id: 'r-102-1', attribute: 'app.version', operator: 'gte', value: '9.2.0', negate: false },
      { id: 'r-102-2', attribute: 'user.segment', operator: 'in', value: 'active,high_intent', negate: false },
    ],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH'],
    minClientVersion: { dev: '9.1.0', staging: '9.2.0', production: '9.2.0' },
    dependencies: [{ flagId: 'flag-105', type: 'requires', condition: '特征服务延迟稳定在 80ms 内' }],
    rollbackConditions: ['推荐模块点击率下降 15%', '接口超时率高于 2%'],
    metricNames: ['recommend_ctr', 'feature_service_timeout_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [
      { id: 's-201', percentage: 10, audience: '活跃用户', startedAt: '2026-09-20T10:00:00+08:00', status: 'completed', guardrails: ['CTR 不低于对照 5%'] },
      { id: 's-202', percentage: 35, audience: '活跃及高意图用户', startedAt: '2026-09-27T10:00:00+08:00', status: 'running', guardrails: ['接口超时率 < 2%'] },
    ],
    createdAt: '2026-08-28T09:30:00+08:00',
    updatedAt: '2026-09-28T16:40:00+08:00',
    lastChangedBy: '周启',
  },
  {
    id: 'flag-103',
    key: 'console.billing-export-v3',
    name: '账单异步导出 V3',
    description: '把大账单导出切换至异步任务和对象存储下载。',
    owner: '周航',
    team: '云控制台',
    status: 'review',
    environment: 'dev',
    enabled: false,
    rolloutPercentage: 0,
    audienceRules: [
      { id: 'r-103-1', attribute: 'account.type', operator: 'equals', value: 'enterprise', negate: false },
    ],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '5.10.0', staging: '5.10.0', production: '5.10.0' },
    dependencies: [{ flagId: 'flag-107', type: 'requires', condition: '异步任务队列容量已扩容' }],
    rollbackConditions: ['任务失败率高于 3%', '导出文件超过 24 小时未生成'],
    metricNames: [],
    deadCodeStatus: 'candidate',
    rolloutSteps: [
      { id: 's-301', percentage: 5, audience: '内部测试企业', startedAt: '2026-10-08T10:00:00+08:00', status: 'planned', guardrails: ['任务成功率 > 98%'] },
    ],
    createdAt: '2026-09-18T11:10:00+08:00',
    updatedAt: '2026-09-28T18:20:00+08:00',
    lastChangedBy: '周航',
  },
  {
    id: 'flag-104',
    key: 'payment.aggregate-router',
    name: '支付聚合路由',
    description: '统一收单渠道和支付降级策略。',
    owner: '韩秋',
    team: '支付平台',
    status: 'active',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH', 'CN-WEST'],
    minClientVersion: { dev: '8.12.0', staging: '8.12.0', production: '8.12.0' },
    dependencies: [],
    rollbackConditions: ['任一收单渠道连续失败 20 次'],
    metricNames: ['payment_router_error_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-401', percentage: 100, audience: '全部用户', startedAt: '2026-07-01T00:00:00+08:00', status: 'completed', guardrails: [] }],
    createdAt: '2026-06-12T10:00:00+08:00',
    updatedAt: '2026-09-25T12:30:00+08:00',
    lastChangedBy: '韩秋',
  },
  {
    id: 'flag-105',
    key: 'feature.realtime-profile',
    name: '实时用户特征服务',
    description: '向推荐和搜索模块提供实时画像特征。',
    owner: '郭宁',
    team: '数据平台',
    status: 'frozen',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 60,
    audienceRules: [],
    regions: ['CN-EAST', 'CN-SOUTH'],
    minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
    dependencies: [],
    rollbackConditions: ['P99 延迟高于 350ms'],
    metricNames: ['feature_service_latency', 'feature_cache_hit_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-501', percentage: 60, audience: '推荐服务流量', startedAt: '2026-09-28T09:00:00+08:00', status: 'paused', guardrails: ['观察缓存命中率'] }],
    createdAt: '2026-05-18T13:40:00+08:00',
    updatedAt: '2026-09-29T08:50:00+08:00',
    lastChangedBy: '郭宁',
  },
  {
    id: 'flag-106',
    key: 'campaign.new-editor',
    name: '活动配置新版编辑器',
    description: '提供拖拽式活动页面配置能力。',
    owner: '梁琪',
    team: '增长运营',
    status: 'rolled-back',
    environment: 'production',
    enabled: false,
    rolloutPercentage: 0,
    audienceRules: [{ id: 'r-106-1', attribute: 'operator.role', operator: 'equals', value: 'campaign_admin', negate: false }],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '2.6.0', staging: '2.6.0', production: '2.6.0' },
    dependencies: [],
    rollbackConditions: ['配置保存失败率高于 2%'],
    metricNames: ['campaign_editor_save_success'],
    deadCodeStatus: 'confirmed',
    rolloutSteps: [{ id: 's-601', percentage: 20, audience: '华东运营团队', startedAt: '2026-09-27T14:00:00+08:00', status: 'paused', guardrails: [] }],
    createdAt: '2026-08-20T10:15:00+08:00',
    updatedAt: '2026-09-28T15:48:00+08:00',
    lastChangedBy: '梁琪',
  },
  {
    id: 'flag-107',
    key: 'infra.async-task-queue-v2',
    name: '异步任务队列 V2',
    description: '迁移长任务至高吞吐队列。',
    owner: '赵岚',
    team: '基础架构',
    status: 'active',
    environment: 'staging',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
    dependencies: [],
    rollbackConditions: ['队列积压超过 10 万'],
    metricNames: ['queue_backlog', 'task_failure_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-701', percentage: 100, audience: '预发长任务', startedAt: '2026-09-22T09:00:00+08:00', status: 'completed', guardrails: [] }],
    createdAt: '2026-08-10T16:20:00+08:00',
    updatedAt: '2026-09-27T11:12:00+08:00',
    lastChangedBy: '赵岚',
  },
  {
    id: 'flag-108',
    key: 'checkout.legacy-coupon-overlay',
    name: '旧版优惠券浮层',
    description: '结算页旧优惠券选择浮层，计划下版本下线。',
    owner: '沈宁',
    team: '交易体验',
    status: 'frozen',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 12,
    audienceRules: [{ id: 'r-108-1', attribute: 'app.version', operator: 'lte', value: '8.17.9', negate: false }],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH'],
    minClientVersion: { dev: '8.10.0', staging: '8.10.0', production: '8.10.0' },
    dependencies: [{ flagId: 'flag-101', type: 'conflicts', condition: '新版支付流程不可同时启用' }],
    rollbackConditions: ['优惠券使用率下降 10%'],
    metricNames: ['coupon_apply_success_rate'],
    deadCodeStatus: 'confirmed',
    rolloutSteps: [{ id: 's-801', percentage: 12, audience: '低版本客户端', startedAt: '2026-09-20T09:00:00+08:00', status: 'paused', guardrails: [] }],
    createdAt: '2025-12-10T09:00:00+08:00',
    updatedAt: '2026-09-29T09:10:00+08:00',
    lastChangedBy: '沈宁',
  },
]

const issues: ImpactIssue[] = [
  {
    id: 'issue-1',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    category: 'overlap',
    severity: 'blocker',
    title: '与旧版优惠券实验组重叠',
    detail: '20% 灰度人群中有 3.8% 同时命中 checkout.legacy-coupon-overlay。',
    suggestion: '将 risk_score <= 40 与旧版浮层实验排除条件合并，或先将旧开关灰度降至 0。',
    resolved: false,
  },
  {
    id: 'issue-2',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    category: 'client-compatibility',
    severity: 'warning',
    title: '低版本客户端缺少聚合支付能力',
    detail: 'iOS 8.17.x 用户仍会命中新流程，但客户端未注册 pay.aggregate.v2。',
    suggestion: '把 app.version >= 8.18.0 加入受众前置条件。',
    resolved: false,
  },
  {
    id: 'issue-3',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    category: 'missing-metric',
    severity: 'blocker',
    title: '缺少下载完成率监控',
    detail: '当前仅配置任务创建指标，无法自动触发导出文件生成失败回滚。',
    suggestion: '接入 billing_export_download_success_rate 并配置 15 分钟窗口。',
    resolved: false,
  },
  {
    id: 'issue-4',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    category: 'dead-code',
    severity: 'warning',
    title: '旧同步导出入口仍可达',
    detail: '代码扫描发现 feature.billing_export_sync 分支仍被路由引用。',
    suggestion: '提供旧入口下线任务，并在新开关全量后移除分支。',
    resolved: false,
  },
  {
    id: 'issue-5',
    flagId: 'flag-106',
    flagKey: 'campaign.new-editor',
    category: 'rule-conflict',
    severity: 'warning',
    title: '保存权限中存在互斥角色条件',
    detail: '角色 equals campaign_admin 与后续 not-equals 临时审核员规则同时存在。',
    suggestion: '合并为明确的白名单，避免规则求值顺序变化。',
    resolved: true,
  },
  {
    id: 'issue-6',
    flagId: 'flag-108',
    flagKey: 'checkout.legacy-coupon-overlay',
    category: 'dead-code',
    severity: 'info',
    title: '开关已进入下线候选',
    detail: '最近 30 天没有新增代码引用，仅保留旧客户端兼容分支。',
    suggestion: '在最低客户端版本达到 8.18.0 后安排代码清理。',
    resolved: false,
  },
]

const audit: AuditEvent[] = [
  {
    id: 'audit-1',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    action: 'rollout-adjusted',
    actor: '陈思远',
    summary: '灰度比例由 5% 调整至 20%，仅覆盖 iOS 金卡及铂金用户。',
    before: '5%',
    after: '20%',
    affectedUsers: 48620,
    createdAt: '2026-09-29T09:05:00+08:00',
  },
  {
    id: 'audit-2',
    flagId: 'flag-105',
    flagKey: 'feature.realtime-profile',
    action: 'frozen',
    actor: '郭宁',
    summary: 'P99 延迟升高，冻结配置并暂停扩大流量。',
    before: 'active',
    after: 'frozen',
    affectedUsers: 1200000,
    createdAt: '2026-09-29T08:50:00+08:00',
  },
  {
    id: 'audit-3',
    flagId: 'flag-106',
    flagKey: 'campaign.new-editor',
    action: 'rolled-back',
    actor: '梁琪',
    summary: '配置保存失败率触发自动回滚条件。',
    before: '20%',
    after: '0%',
    affectedUsers: 638,
    createdAt: '2026-09-28T15:48:00+08:00',
  },
  {
    id: 'audit-4',
    flagId: 'flag-102',
    flagKey: 'catalog.smart-recommendation',
    action: 'rollout-adjusted',
    actor: '周启',
    summary: '灰度扩大到 35%，推荐接口错误率保持低于阈值。',
    before: '20%',
    after: '35%',
    affectedUsers: 812430,
    createdAt: '2026-09-28T16:40:00+08:00',
  },
  {
    id: 'audit-5',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    action: 'submitted',
    actor: '周航',
    summary: '提交发布评审，等待补齐导出完成率监控。',
    before: 'draft',
    after: 'draft',
    affectedUsers: 0,
    createdAt: '2026-09-28T18:20:00+08:00',
  },
  {
    id: 'audit-6',
    flagId: 'flag-104',
    flagKey: 'payment.aggregate-router',
    action: 'approved',
    actor: '林默',
    summary: '确认回滚条件和支付通道指标完整。',
    before: 'review',
    after: 'active',
    affectedUsers: 3200000,
    createdAt: '2026-09-25T12:30:00+08:00',
  },
]

const nowIso = () => new Date().toISOString()

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const compareVersions = (left: string, right: string): number => {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const fingerprintOf = (entry: Omit<BatchEnvSnapshot, 'fingerprint'>): string =>
  JSON.stringify({
    enabled: entry.enabled,
    rolloutPercentage: entry.rolloutPercentage,
    audienceRules: entry.audienceRules,
    dependencies: entry.dependencies,
    minClientVersion: entry.minClientVersion,
    rolloutSteps: entry.rolloutSteps,
  })

const withFingerprint = (entry: Omit<BatchEnvSnapshot, 'fingerprint'>): BatchEnvSnapshot => ({
  ...entry,
  fingerprint: fingerprintOf(entry),
})

const snapshotFromFlag = (flag: FeatureFlag, environment: Environment): BatchEnvSnapshot =>
  withFingerprint({
    environment,
    flagId: flag.id,
    status: flag.status,
    enabled: flag.enabled,
    rolloutPercentage: flag.rolloutPercentage,
    audienceRules: clone(flag.audienceRules),
    dependencies: clone(flag.dependencies),
    minClientVersion: flag.minClientVersion[environment],
    rolloutSteps: clone(flag.rolloutSteps),
  })

const deriveSnapshotEntry = (sourceFlag: FeatureFlag, environment: Environment): BatchEnvSnapshot =>
  withFingerprint({
    environment,
    flagId: '',
    status: 'draft',
    enabled: sourceFlag.enabled,
    rolloutPercentage: sourceFlag.rolloutPercentage,
    audienceRules: clone(sourceFlag.audienceRules),
    dependencies: clone(sourceFlag.dependencies),
    minClientVersion: sourceFlag.minClientVersion[environment],
    rolloutSteps: clone(sourceFlag.rolloutSteps),
  })

const buildChecks = (
  key: string,
  sourceEnvironment: Environment,
  targetEnvironments: Environment[],
  snapshot: BatchEnvSnapshot[],
  flags: FeatureFlag[],
): BatchCheckItem[] => {
  const checks: BatchCheckItem[] = []
  const sourceEntry = snapshot.find((entry) => entry.environment === sourceEnvironment)
  sourceEntry?.dependencies
    .filter((dependency) => dependency.type === 'requires')
    .forEach((dependency) => {
      const dependencyFlag = flags.find((flag) => flag.id === dependency.flagId)
      checks.push({
        id: `check-dep-${dependency.flagId}`,
        kind: 'dependency',
        label: `依赖开关 ${dependencyFlag?.key ?? dependency.flagId} 未回滚且保持启用`,
        detail: dependency.condition,
        confirmed: false,
        blocked:
          !dependencyFlag || dependencyFlag.status === 'rolled-back' || !dependencyFlag.enabled,
      })
    })
  targetEnvironments.forEach((environment) => {
    const entry = snapshot.find((item) => item.environment === environment)
    if (!entry) return
    const live = flags.find((flag) => flag.key === key && flag.environment === environment)
    const sourceFlag = flags.find(
      (flag) => flag.key === key && flag.environment === sourceEnvironment,
    )
    const currentVersion =
      live?.minClientVersion[environment] ?? sourceFlag?.minClientVersion[environment] ?? '0.0.0'
    checks.push({
      id: `check-version-${environment}`,
      kind: 'client-version',
      label: `${environmentLabels[environment]}最低客户端版本 ≥ ${entry.minClientVersion}`,
      detail: live
        ? `当前基线 ${currentVersion}`
        : `目标环境未部署，按来源基线 ${currentVersion} 校验`,
      confirmed: false,
      blocked: compareVersions(currentVersion, entry.minClientVersion) < 0,
    })
  })
  const percentages: Partial<Record<Environment, number>> = {}
  flags
    .filter((flag) => flag.key === key)
    .forEach((flag) => {
      percentages[flag.environment] = flag.rolloutPercentage
    })
  snapshot.forEach((entry) => {
    if (entry.environment !== sourceEnvironment) {
      percentages[entry.environment] = entry.rolloutPercentage
    }
  })
  const orderPairs: Array<[Environment, Environment]> = [
    ['dev', 'staging'],
    ['staging', 'production'],
  ]
  const conflict = orderPairs.find(([upper, lower]) => {
    const up = percentages[upper]
    const down = percentages[lower]
    return up !== undefined && down !== undefined && down > up
  })
  checks.push({
    id: 'check-rollout-order',
    kind: 'rollout-order',
    label: '多环境灰度顺序 开发 ≥ 预发 ≥ 生产',
    detail: conflict
      ? `${environmentLabels[conflict[1]]} ${percentages[conflict[1]]}% 超过${environmentLabels[conflict[0]]} ${percentages[conflict[0]]}%`
      : `发布后 ${percentages.dev ?? '-'}% / ${percentages.staging ?? '-'}% / ${percentages.production ?? '-'}%`,
    confirmed: false,
    blocked: Boolean(conflict),
  })
  return checks
}

const evaluateChecks = (batch: ReleaseBatch, flags: FeatureFlag[]): BatchCheckItem[] =>
  buildChecks(batch.key, batch.sourceEnvironment, batch.targetEnvironments, batch.snapshot, flags).map(
    (check) => {
      const previous = batch.checks.find((item) => item.id === check.id)
      return { ...check, confirmed: check.blocked ? false : (previous?.confirmed ?? false) }
    },
  )

const pushBatchAudit = (
  db: Database,
  batch: ReleaseBatch,
  action: AuditEvent['action'],
  actor: string,
  summary: string,
  before?: string,
  after?: string,
): void => {
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    flagId: batch.id,
    flagKey: batch.key,
    action,
    actor,
    summary,
    before,
    after,
    affectedUsers: 0,
    createdAt: nowIso(),
  })
}

export const invalidateStaleBatches = (db: Database): void => {
  db.batches.forEach((batch) => {
    if (batch.status !== 'pending') return
    const staleEntry = batch.snapshot.find((entry) => {
      const live = db.flags.find(
        (flag) => flag.key === batch.key && flag.environment === entry.environment,
      )
      if (!live) return Boolean(entry.flagId)
      return snapshotFromFlag(live, entry.environment).fingerprint !== entry.fingerprint
    })
    if (!staleEntry) return
    batch.status = 'invalidated'
    batch.invalidatedReason = `${environmentLabels[staleEntry.environment]}配置在批准前发生变化，候选批次已失效`
    batch.updatedAt = nowIso()
    batch.revision += 1
    pushBatchAudit(
      db,
      batch,
      'batch-invalidated',
      '系统',
      `${environmentLabels[staleEntry.environment]}受众、依赖、版本或灰度阶段被修改，候选批次自动失效。`,
      'pending',
      'invalidated',
    )
  })
}

const buildSeedBatches = (seedFlags: FeatureFlag[]): ReleaseBatch[] => {
  const find = (key: string, environment: Environment) =>
    seedFlags.find((flag) => flag.key === key && flag.environment === environment)
  const expressPay = find('checkout.express-pay-v2', 'staging')
  const billing = find('console.billing-export-v3', 'dev')
  const recommend = find('catalog.smart-recommendation', 'production')
  if (!expressPay || !billing || !recommend) return []

  const expressPaySnapshot = [
    snapshotFromFlag(expressPay, 'staging'),
    deriveSnapshotEntry(expressPay, 'production'),
  ]
  const expressPayChecks = buildChecks(
    expressPay.key,
    'staging',
    ['production'],
    expressPaySnapshot,
    seedFlags,
  ).map((check) => ({ ...check, confirmed: check.kind === 'dependency' }))

  const billingStagingEntry = withFingerprint({
    ...deriveSnapshotEntry(billing, 'staging'),
    rolloutPercentage: 5,
  })
  const billingProductionEntry = withFingerprint({
    ...deriveSnapshotEntry(billing, 'production'),
    rolloutPercentage: 5,
  })
  const billingSnapshot = [snapshotFromFlag(billing, 'dev'), billingStagingEntry, billingProductionEntry]
  const billingChecks = buildChecks(
    billing.key,
    'dev',
    ['staging', 'production'],
    billingSnapshot,
    seedFlags,
  ).map((check) => ({ ...check, confirmed: check.kind !== 'rollout-order' && !check.blocked }))

  const recommendStagingEntry = withFingerprint({
    ...deriveSnapshotEntry(recommend, 'staging'),
    rolloutPercentage: 50,
  })
  const recommendSnapshot = [recommendStagingEntry, snapshotFromFlag(recommend, 'production')]
  const recommendPreRelease: BatchEnvSnapshot[] = [
    withFingerprint({
      environment: 'production',
      flagId: recommend.id,
      status: 'active',
      enabled: true,
      rolloutPercentage: 20,
      audienceRules: clone(recommend.audienceRules),
      dependencies: clone(recommend.dependencies),
      minClientVersion: recommend.minClientVersion.production,
      rolloutSteps: [
        { id: 's-201', percentage: 10, audience: '活跃用户', startedAt: '2026-09-20T10:00:00+08:00', status: 'completed', guardrails: ['CTR 不低于对照 5%'] },
        { id: 's-202', percentage: 20, audience: '活跃用户', startedAt: '2026-09-25T10:00:00+08:00', status: 'running', guardrails: ['接口超时率 < 2%'] },
      ],
    }),
  ]
  const recommendChecks = buildChecks(
    recommend.key,
    'staging',
    ['production'],
    recommendSnapshot,
    seedFlags,
  ).map((check) => ({ ...check, confirmed: true }))

  return [
    {
      id: 'batch-1',
      key: expressPay.key,
      name: '极速支付流程 V2 多环境批次',
      sourceEnvironment: 'staging',
      targetEnvironments: ['production'],
      status: 'pending',
      revision: 1,
      snapshot: expressPaySnapshot,
      checks: expressPayChecks,
      createdBy: '陈思远',
      createdAt: '2026-09-29T10:20:00+08:00',
      updatedAt: '2026-09-29T10:20:00+08:00',
    },
    {
      id: 'batch-2',
      key: billing.key,
      name: '账单异步导出 V3 多环境批次',
      sourceEnvironment: 'dev',
      targetEnvironments: ['staging', 'production'],
      status: 'pending',
      revision: 2,
      snapshot: billingSnapshot,
      checks: billingChecks,
      createdBy: '周航',
      createdAt: '2026-09-28T18:30:00+08:00',
      updatedAt: '2026-09-29T09:40:00+08:00',
    },
    {
      id: 'batch-3',
      key: recommend.key,
      name: '商品智能推荐位放量批次',
      sourceEnvironment: 'staging',
      targetEnvironments: ['production'],
      status: 'released',
      revision: 3,
      snapshot: recommendSnapshot,
      preReleaseSnapshot: recommendPreRelease,
      checks: recommendChecks,
      createdBy: '许薇',
      createdAt: '2026-09-27T15:00:00+08:00',
      updatedAt: '2026-09-28T16:40:00+08:00',
      approvedBy: '林默',
      approvedAt: '2026-09-28T15:10:00+08:00',
      releasedAt: '2026-09-28T16:40:00+08:00',
    },
  ]
}

const seedBatchAudit: AuditEvent[] = [
  {
    id: 'audit-batch-1',
    flagId: 'batch-1',
    flagKey: 'checkout.express-pay-v2',
    action: 'batch-created',
    actor: '陈思远',
    summary: '创建多环境发布批次，锁定预发受众、依赖开关、最低客户端版本与灰度阶段。',
    after: 'pending',
    affectedUsers: 0,
    createdAt: '2026-09-29T10:20:00+08:00',
  },
  {
    id: 'audit-batch-2',
    flagId: 'batch-2',
    flagKey: 'console.billing-export-v3',
    action: 'batch-blocked',
    actor: '林默',
    summary: '发布门禁未通过：预发 5% 超过开发 0%，多环境灰度顺序冲突，整批停在待处理。',
    before: 'approved',
    after: 'pending',
    affectedUsers: 0,
    createdAt: '2026-09-29T09:40:00+08:00',
  },
  {
    id: 'audit-batch-3',
    flagId: 'batch-3',
    flagKey: 'catalog.smart-recommendation',
    action: 'batch-released',
    actor: '林默',
    summary: '批次发布完成，生产灰度由 20% 推进至 35%，发布前状态已留存可回滚。',
    before: 'approved',
    after: 'released',
    affectedUsers: 812430,
    createdAt: '2026-09-28T16:40:00+08:00',
  },
]

export const seedDatabase = (): Database => ({
  flags,
  audit: [...seedBatchAudit, ...audit],
  issues,
  batches: buildSeedBatches(flags),
})

export const readDatabase = (): Database => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seed = seedDatabase()
    writeDatabase(seed)
    return seed
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Database>
    return {
      flags: parsed.flags ?? [],
      audit: parsed.audit ?? [],
      issues: parsed.issues ?? [],
      batches: parsed.batches ?? [],
    }
  } catch {
    const seed = seedDatabase()
    writeDatabase(seed)
    return seed
  }
}

export const writeDatabase = (database: Database): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
}

export const applyReview = (flagId: string, payload: ReviewPayload): FeatureFlag => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const before = flag.status
  flag.status = payload.decision === 'approved' ? 'active' : 'draft'
  flag.enabled = payload.decision === 'approved'
  flag.updatedAt = new Date().toISOString()
  flag.lastChangedBy = payload.reviewer
  db.audit.unshift({
    id: `audit-${Date.now()}`,
    flagId,
    flagKey: flag.key,
    action: payload.decision,
    actor: payload.reviewer,
    summary: payload.comment,
    before,
    after: flag.status,
    affectedUsers: Math.round(120000 * (flag.rolloutPercentage / 100)),
    createdAt: new Date().toISOString(),
  })
  if (payload.freezeUntil && payload.decision === 'approved') {
    flag.rollbackConditions.push(`冻结至 ${payload.freezeUntil}，期间禁止扩大流量`)
  }
  invalidateStaleBatches(db)
  writeDatabase(db)
  return flag
}

export const rollbackFlag = (flagId: string, actor: string, reason: string): FeatureFlag => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const before = `${flag.status} / ${flag.rolloutPercentage}%`
  flag.status = 'rolled-back'
  flag.enabled = false
  flag.rolloutPercentage = 0
  flag.updatedAt = new Date().toISOString()
  flag.lastChangedBy = actor
  flag.rolloutSteps.forEach((step) => {
    if (step.status === 'running') step.status = 'paused'
  })
  db.audit.unshift({
    id: `audit-${Date.now()}`,
    flagId,
    flagKey: flag.key,
    action: 'rolled-back',
    actor,
    summary: reason,
    before,
    after: 'rolled-back / 0%',
    affectedUsers: Math.round(980000 * (flag.rolloutPercentage / 100)),
    createdAt: new Date().toISOString(),
  })
  invalidateStaleBatches(db)
  writeDatabase(db)
  return flag
}

export const getDashboardStats = (): DashboardData => {
  const db = readDatabase()
  return {
    activeFlags: db.flags.filter((flag) => flag.enabled).length,
    pendingReview: db.flags.filter((flag) => flag.status === 'review').length + 2,
    blockerIssues: db.issues.filter((issue) => issue.severity === 'blocker' && !issue.resolved).length,
    affectedUsers: 5246900,
    environmentDiff: [
      { flag: '极速支付流程 V2', dev: 100, staging: 20, production: 0 },
      { flag: '账单异步导出 V3', dev: 5, staging: 0, production: 0 },
      { flag: '商品智能推荐位', dev: 100, staging: 50, production: 35 },
      { flag: '实时用户特征服务', dev: 100, staging: 80, production: 60 },
    ],
    adoptionTrend: [
      { date: '09-23', flags: 18, rollbacks: 1 },
      { date: '09-24', flags: 21, rollbacks: 0 },
      { date: '09-25', flags: 19, rollbacks: 2 },
      { date: '09-26', flags: 24, rollbacks: 1 },
      { date: '09-27', flags: 27, rollbacks: 0 },
      { date: '09-28', flags: 31, rollbacks: 3 },
      { date: '09-29', flags: 29, rollbacks: 1 },
    ],
  }
}

export const createBatch = (input: CreateBatchInput): ReleaseBatch => {
  const db = readDatabase()
  const sourceFlag = db.flags.find(
    (flag) => flag.key === input.key && flag.environment === input.sourceEnvironment,
  )
  if (!sourceFlag) throw new Error('来源环境不存在该开关')
  if (input.targetEnvironments.length === 0) throw new Error('至少选择一个目标环境')
  const snapshot: BatchEnvSnapshot[] = [snapshotFromFlag(sourceFlag, input.sourceEnvironment)]
  input.targetEnvironments.forEach((environment) => {
    const existing = db.flags.find(
      (flag) => flag.key === input.key && flag.environment === environment,
    )
    snapshot.push(
      existing ? snapshotFromFlag(existing, environment) : deriveSnapshotEntry(sourceFlag, environment),
    )
  })
  const batch: ReleaseBatch = {
    id: `batch-${Date.now()}`,
    key: input.key,
    name: input.name.trim() || `${input.key} 多环境批次`,
    sourceEnvironment: input.sourceEnvironment,
    targetEnvironments: input.targetEnvironments,
    status: 'pending',
    revision: 1,
    snapshot,
    checks: buildChecks(input.key, input.sourceEnvironment, input.targetEnvironments, snapshot, db.flags),
    createdBy: input.actor,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  db.batches.unshift(batch)
  pushBatchAudit(
    db,
    batch,
    'batch-created',
    input.actor,
    `创建多环境发布批次，锁定${environmentLabels[input.sourceEnvironment]}受众、依赖开关、最低客户端版本与灰度阶段。`,
    undefined,
    'pending',
  )
  writeDatabase(db)
  return batch
}

export const approveBatch = (id: string, actor: string, expectedRevision: number): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.revision !== expectedRevision) {
    throw new Error('批次已被其他窗口变更，请刷新后重试')
  }
  if (batch.status !== 'pending') throw new Error('仅待处理的候选批次可以批准')
  batch.status = 'approved'
  batch.approvedBy = actor
  batch.approvedAt = nowIso()
  batch.updatedAt = nowIso()
  batch.revision += 1
  db.batches.forEach((other) => {
    if (other.id === batch.id || other.key !== batch.key || other.status !== 'pending') return
    other.status = 'superseded'
    other.invalidatedReason = `已被批次「${batch.name}」取代，仅保留一个有效批次`
    other.updatedAt = nowIso()
    other.revision += 1
    pushBatchAudit(
      db,
      other,
      'batch-superseded',
      actor,
      `同 Key 批次「${batch.name}」已批准，本候选批次被取代。`,
      'pending',
      'superseded',
    )
  })
  pushBatchAudit(
    db,
    batch,
    'batch-approved',
    actor,
    '批准多环境发布批次，同 Key 其他候选批次已标记为被取代。',
    'pending',
    'approved',
  )
  writeDatabase(db)
  return batch
}

export const revalidateBatch = (id: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'pending' && batch.status !== 'approved') {
    throw new Error('当前状态不需要重新校验')
  }
  batch.checks = evaluateChecks(batch, db.flags)
  batch.updatedAt = nowIso()
  batch.revision += 1
  writeDatabase(db)
  return batch
}

export const confirmBatchCheck = (id: string, checkId: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'pending' && batch.status !== 'approved') {
    throw new Error('当前状态不可确认检查项')
  }
  batch.checks = evaluateChecks(batch, db.flags)
  const check = batch.checks.find((item) => item.id === checkId)
  if (!check) throw new Error('检查项不存在')
  if (check.blocked) throw new Error('阻断项需先解除阻断后再确认')
  check.confirmed = true
  batch.updatedAt = nowIso()
  batch.revision += 1
  writeDatabase(db)
  return batch
}

export const releaseBatch = (id: string, actor: string, expectedRevision: number): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.revision !== expectedRevision) {
    throw new Error('批次已被其他窗口变更，请刷新后重试')
  }
  if (batch.status !== 'approved') throw new Error('仅已批准的批次可以发布')
  batch.checks = evaluateChecks(batch, db.flags)
  const blocked = batch.checks.filter((check) => check.blocked)
  if (blocked.length > 0) {
    batch.status = 'pending'
    batch.updatedAt = nowIso()
    batch.revision += 1
    pushBatchAudit(
      db,
      batch,
      'batch-blocked',
      actor,
      `发布门禁未通过：${blocked.map((check) => check.label).join('；')}，整批停在待处理。`,
      'approved',
      'pending',
    )
    writeDatabase(db)
    throw new Error(`存在 ${blocked.length} 个阻断项，批次已停在待处理`)
  }
  if (batch.checks.some((check) => !check.confirmed)) {
    throw new Error('请先确认全部检查项后再发布')
  }
  const preRelease: BatchEnvSnapshot[] = []
  batch.targetEnvironments.forEach((environment) => {
    const entry = batch.snapshot.find((item) => item.environment === environment)
    if (!entry) return
    const live = db.flags.find(
      (flag) => flag.key === batch.key && flag.environment === environment,
    )
    if (live) {
      preRelease.push(snapshotFromFlag(live, environment))
      live.enabled = entry.enabled
      live.status = 'active'
      live.rolloutPercentage = entry.rolloutPercentage
      live.audienceRules = clone(entry.audienceRules)
      live.dependencies = clone(entry.dependencies)
      live.minClientVersion = { ...live.minClientVersion, [environment]: entry.minClientVersion }
      live.rolloutSteps = clone(entry.rolloutSteps)
      live.updatedAt = nowIso()
      live.lastChangedBy = actor
    } else {
      preRelease.push({ ...entry, flagId: '', status: 'draft', fingerprint: '' })
      const sourceFlag = db.flags.find(
        (flag) => flag.key === batch.key && flag.environment === batch.sourceEnvironment,
      )
      if (!sourceFlag) return
      db.flags.unshift({
        ...clone(sourceFlag),
        id: `flag-${Date.now()}-${environment}`,
        environment,
        enabled: entry.enabled,
        status: 'active',
        rolloutPercentage: entry.rolloutPercentage,
        audienceRules: clone(entry.audienceRules),
        dependencies: clone(entry.dependencies),
        minClientVersion: { ...sourceFlag.minClientVersion, [environment]: entry.minClientVersion },
        rolloutSteps: clone(entry.rolloutSteps),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastChangedBy: actor,
      })
    }
  })
  batch.preReleaseSnapshot = preRelease
  batch.status = 'released'
  batch.releasedAt = nowIso()
  batch.updatedAt = nowIso()
  batch.revision += 1
  pushBatchAudit(
    db,
    batch,
    'batch-released',
    actor,
    `批次发布完成，${batch.targetEnvironments.map((env) => environmentLabels[env]).join('、')}已应用锁定快照，发布前状态已留存可回滚。`,
    'approved',
    'released',
  )
  invalidateStaleBatches(db)
  writeDatabase(db)
  return batch
}

export const rollbackBatch = (id: string, actor: string, reason: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('发布批次不存在')
  if (batch.status !== 'released') throw new Error('仅已发布的批次可以回滚')
  const preRelease = batch.preReleaseSnapshot ?? []
  preRelease.forEach((entry) => {
    if (!entry.flagId) {
      db.flags = db.flags.filter(
        (flag) => !(flag.key === batch.key && flag.environment === entry.environment),
      )
      return
    }
    const live = db.flags.find((flag) => flag.id === entry.flagId)
    if (!live) return
    live.enabled = entry.enabled
    live.status = entry.status
    live.rolloutPercentage = entry.rolloutPercentage
    live.audienceRules = clone(entry.audienceRules)
    live.dependencies = clone(entry.dependencies)
    live.minClientVersion = { ...live.minClientVersion, [entry.environment]: entry.minClientVersion }
    live.rolloutSteps = clone(entry.rolloutSteps)
    live.updatedAt = nowIso()
    live.lastChangedBy = actor
  })
  batch.status = 'rolled-back'
  batch.rolledBackAt = nowIso()
  batch.rollbackReason = reason
  batch.updatedAt = nowIso()
  batch.revision += 1
  pushBatchAudit(
    db,
    batch,
    'batch-rolled-back',
    actor,
    `批次回滚：${reason}。已恢复发布前的受众、依赖与灰度阶段，旧快照保留可查。`,
    'released',
    'rolled-back',
  )
  invalidateStaleBatches(db)
  writeDatabase(db)
  return batch
}
