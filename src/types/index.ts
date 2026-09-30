export type FlagStatus = 'draft' | 'review' | 'active' | 'frozen' | 'rolled-back'
export type Environment = 'dev' | 'staging' | 'production'
export type RuleOperator = 'equals' | 'not-equals' | 'contains' | 'in' | 'gte' | 'lte'
export type IssueSeverity = 'blocker' | 'warning' | 'info'
export type IssueCategory =
  | 'rule-conflict'
  | 'dead-code'
  | 'missing-metric'
  | 'overlap'
  | 'client-compatibility'

export const ENV_ORDER: Environment[] = ['dev', 'staging', 'production']

export interface AudienceRule {
  id: string
  attribute: string
  operator: RuleOperator
  value: string
  negate: boolean
}

export interface RolloutStep {
  id: string
  percentage: number
  audience: string
  startedAt: string
  status: 'completed' | 'running' | 'planned' | 'paused'
  guardrails: string[]
}

export interface Dependency {
  flagId: string
  type: 'requires' | 'conflicts' | 'fallback'
  condition: string
}

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description: string
  owner: string
  team: string
  status: FlagStatus
  environment: Environment
  enabled: boolean
  rolloutPercentage: number
  audienceRules: AudienceRule[]
  regions: string[]
  minClientVersion: Record<Environment, string>
  dependencies: Dependency[]
  rollbackConditions: string[]
  metricNames: string[]
  deadCodeStatus: 'clean' | 'candidate' | 'confirmed'
  rolloutSteps: RolloutStep[]
  createdAt: string
  updatedAt: string
  lastChangedBy: string
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'frozen'
  | 'unfrozen'
  | 'rolled-back'
  | 'rollout-adjusted'
  | 'batch-created'
  | 'batch-confirmed'
  | 'batch-invalidated'
  | 'batch-superseded'
  | 'batch-published'
  | 'batch-blocked'
  | 'batch-resolved'
  | 'batch-rebuilt'
  | 'batch-released'
  | 'batch-reverted'
  | 'env-changed'

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  action: AuditAction
  actor: string
  summary: string
  before?: string
  after?: string
  affectedUsers: number
  createdAt: string
  batchId?: string
  env?: Environment
}

export interface ImpactIssue {
  id: string
  flagId: string
  flagKey: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  detail: string
  suggestion: string
  resolved: boolean
}

export interface DashboardData {
  activeFlags: number
  pendingReview: number
  blockerIssues: number
  affectedUsers: number
  environmentDiff: Array<{ flag: string; dev: number; staging: number; production: number }>
  adoptionTrend: Array<{ date: string; flags: number; rollbacks: number }>
}

export interface FlagFilter {
  keyword?: string
  status?: FlagStatus | ''
  environment?: Environment | ''
  team?: string
  owner?: string
}

export interface ReviewPayload {
  reviewer: string
  decision: 'approved' | 'rejected'
  comment: string
  freezeUntil?: string
}

/* ------------------------------ 发布批次 ------------------------------ */

export type EnvStatus = 'active' | 'frozen' | 'rolled-back'

export type BatchStatus =
  | 'collecting' // 待处理·收批准中
  | 'ready' // 全部环境批准、等待发布
  | 'blocked' // 发布前闸门未通过，停在待处理
  | 'published' // 已发布
  | 'rolled-back' // 批次已整批回滚
  | 'invalidated' // 批准前任一环境发生改动，候选失效
  | 'superseded' // 同 Key 另一批次先完成，本候选作废

export type BlockerType = 'dependency-rolled-back' | 'client-version' | 'rollout-order'

/** 各环境当前线上状态（来源环境落在 flags 表，其余落在 envStates） */
export interface EnvRuntimeState {
  key: string
  env: Environment
  enabled: boolean
  status: EnvStatus
  percentage: number
  audienceRules: AudienceRule[]
  minClientVersion: string
  stageLabel: string
  stageSteps: RolloutStep[]
  dependencies: Dependency[]
  /** 依赖开关在本环境的运行态：enabled=false/status=rolled-back 即“依赖回滚” */
  dependencyStates: Array<{ flagId: string; enabled: boolean; status: EnvStatus; percentage: number }>
}

export interface DependencySnapshot {
  flagId: string
  key: string
  name: string
  type: Dependency['type']
  condition: string
  envStates: Record<Environment, { enabled: boolean; status: EnvStatus; percentage: number }>
}

export interface EnvSnapshot {
  env: Environment
  source: boolean
  enabled: boolean
  percentage: number
  audienceRules: AudienceRule[]
  minClientVersion: string
  stageLabel: string
  stageSteps: RolloutStep[]
  /** 建批次时的来源配置指纹，批准前被改动即失效 */
  sourceFingerprint: string
}

export interface BatchConfirmation {
  env: Environment
  actor: string
  confirmedAt: string
  /** 闸门修复后仍保留的确认项 */
  retained: boolean
}

export interface BatchBlocker {
  id: string
  type: BlockerType
  env: Environment
  title: string
  detail: string
  suggestion: string
  /** 已在批次上做过的修复（如同步基线、对齐灰度顺序），仍保留审计痕迹 */
  resolvedLabel?: string
}

export interface RestorePoint {
  env: Environment
  enabled: boolean
  percentage: number
  audienceRules: AudienceRule[]
  stageLabel: string
  stageSteps: RolloutStep[]
  dependencyStates: Array<{ flagId: string; enabled: boolean; status: EnvStatus; percentage: number }>
}

export interface BatchTimelineEvent {
  at: string
  actor: string
  label: string
  detail: string
  tone: 'info' | 'success' | 'warning' | 'error'
}

export interface ReleaseBatch {
  id: string
  key: string
  name: string
  owner: string
  team: string
  sourceEnv: Environment
  targetEnvs: Environment[]
  status: BatchStatus
  createdAt: string
  createdBy: string
  /** 锁定：来源环境、依赖开关、最低客户端版本、灰度阶段 */
  snapshots: EnvSnapshot[]
  dependencyLocks: DependencySnapshot[]
  /** 各环境独立确认窗口 */
  confirmations: BatchConfirmation[]
  /** 发布前闸门最近一次结果 */
  blockers: BatchBlocker[]
  evaluatedAt?: string
  invalidatedReason?: string
  invalidatedAt?: string
  supersededBy?: string
  publishedAt?: string
  publishedBy?: string
  rolledBackAt?: string
  rolledBackBy?: string
  rollbackReason?: string
  /** 发布时的整批还原点（受众/依赖/灰度阶段） */
  restorePoints?: RestorePoint[]
  /** 发布前修复依赖时留存的修复前依赖状态，供整批回滚一并恢复 */
  dependencyRestore?: Array<{ env: Environment; flagId: string; enabled: boolean; status: EnvStatus; percentage: number }>
  history: BatchTimelineEvent[]
  dataVersion: number
}

export interface CreateBatchPayload {
  flagId: string
  sourceEnv: Environment
  targetEnvs: Environment[]
  createdBy: string
  note?: string
}
