export type FlagStatus = 'draft' | 'review' | 'active' | 'frozen' | 'rolled-back'
export type Environment = 'dev' | 'staging' | 'production'
export type BatchStatus =
  | 'pending'
  | 'approved'
  | 'released'
  | 'invalidated'
  | 'superseded'
  | 'rolled-back'
export type BatchCheckKind = 'dependency' | 'client-version' | 'rollout-order'

export const environmentLabels: Record<Environment, string> = {
  dev: '开发环境',
  staging: '预发环境',
  production: '生产环境',
}
export type RuleOperator = 'equals' | 'not-equals' | 'contains' | 'in' | 'gte' | 'lte'
export type IssueSeverity = 'blocker' | 'warning' | 'info'
export type IssueCategory =
  | 'rule-conflict'
  | 'dead-code'
  | 'missing-metric'
  | 'overlap'
  | 'client-compatibility'

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

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  action:
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
    | 'batch-approved'
    | 'batch-released'
    | 'batch-blocked'
    | 'batch-invalidated'
    | 'batch-superseded'
    | 'batch-rolled-back'
  actor: string
  summary: string
  before?: string
  after?: string
  affectedUsers: number
  createdAt: string
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

export interface BatchEnvSnapshot {
  environment: Environment
  flagId: string
  status: FlagStatus
  enabled: boolean
  rolloutPercentage: number
  audienceRules: AudienceRule[]
  dependencies: Dependency[]
  minClientVersion: string
  rolloutSteps: RolloutStep[]
  fingerprint: string
}

export interface BatchCheckItem {
  id: string
  kind: BatchCheckKind
  label: string
  detail: string
  confirmed: boolean
  blocked: boolean
}

export interface ReleaseBatch {
  id: string
  key: string
  name: string
  sourceEnvironment: Environment
  targetEnvironments: Environment[]
  status: BatchStatus
  revision: number
  snapshot: BatchEnvSnapshot[]
  preReleaseSnapshot?: BatchEnvSnapshot[]
  checks: BatchCheckItem[]
  createdBy: string
  createdAt: string
  updatedAt: string
  approvedBy?: string
  approvedAt?: string
  releasedAt?: string
  rolledBackAt?: string
  rollbackReason?: string
  invalidatedReason?: string
}

export interface CreateBatchInput {
  key: string
  name: string
  sourceEnvironment: Environment
  targetEnvironments: Environment[]
  actor: string
}
