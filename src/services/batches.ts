import type {
  AuditAction,
  BatchBlocker,
  BatchConfirmation,
  BatchTimelineEvent,
  CreateBatchPayload,
  Dependency,
  DependencySnapshot,
  EnvRuntimeState,
  EnvSnapshot,
  Environment,
  EnvStatus,
  FeatureFlag,
  ReleaseBatch,
  RestorePoint,
  RolloutStep,
} from '@/types'
import { ENV_ORDER } from '@/types'
import { readDatabase, writeDatabase, type Database } from '@/services/database'

const ACTOR = '林默'
const envWeight: Record<Environment, number> = { dev: 2000, staging: 60000, production: 900000 }

const now = () => new Date().toISOString()

export const envLabel: Record<Environment, string> = {
  dev: '开发',
  staging: '预发',
  production: '生产',
}

/* ------------------------------ 基础工具 ------------------------------ */

const compareVersion = (a: string, b: string): number => {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const mapFlagStatus = (status: FeatureFlag['status']): EnvStatus => {
  if (status === 'frozen') return 'frozen'
  if (status === 'rolled-back') return 'rolled-back'
  return 'active'
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${key}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** 来源配置指纹：受众、开关、版本、灰度阶段以及依赖开关在该环境的运行态 */
export const fingerprintView = (view: EnvRuntimeState): string => {
  const raw = canonical({
    enabled: view.enabled,
    status: view.status,
    percentage: view.percentage,
    minClientVersion: view.minClientVersion,
    stageLabel: view.stageLabel,
    audienceRules: view.audienceRules,
    steps: view.stageSteps.map((step) => ({
      percentage: step.percentage,
      status: step.status,
      audience: step.audience,
    })),
    deps: view.dependencyStates.map((dep) => ({
      flagId: dep.flagId,
      enabled: dep.enabled,
      status: dep.status,
      percentage: dep.percentage,
    })),
  })
  let hash = 0
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i)
    hash |= 0
  }
  return `fp-${(hash >>> 0).toString(36)}-${raw.length}`
}

/* ------------------------------ 实时视图 ------------------------------ */

const representativeFlag = (db: Database, key: string): FeatureFlag | undefined =>
  db.flags.find((flag) => flag.key === key)

const envStateOf = (db: Database, key: string, env: Environment): EnvRuntimeState | undefined =>
  db.envStates.find((state) => state.key === key && state.env === env)

const dependencyStateFor = (
  db: Database,
  dep: Dependency,
  env: Environment,
): { enabled: boolean; status: EnvStatus; percentage: number } => {
  const depFlag = db.flags.find((flag) => flag.id === dep.flagId)
  if (depFlag) {
    if (depFlag.environment === env) {
      return { enabled: depFlag.enabled, status: mapFlagStatus(depFlag.status), percentage: depFlag.rolloutPercentage }
    }
    const state = envStateOf(db, depFlag.key, env)
    if (state) return { enabled: state.enabled, status: state.status, percentage: state.percentage }
  }
  return { enabled: true, status: 'active', percentage: 100 }
}

const viewFromFlag = (db: Database, flag: FeatureFlag, env: Environment): EnvRuntimeState => ({
  key: flag.key,
  env,
  enabled: flag.enabled,
  status: mapFlagStatus(flag.status),
  percentage: flag.rolloutPercentage,
  audienceRules: structuredClone(flag.audienceRules),
  minClientVersion: flag.minClientVersion[env],
  stageLabel: flag.rolloutSteps.find((step) => step.status === 'running')?.audience ?? '未开始灰度',
  stageSteps: structuredClone(flag.rolloutSteps),
  dependencies: structuredClone(flag.dependencies),
  dependencyStates: flag.dependencies.map((dep) => ({ flagId: dep.flagId, ...dependencyStateFor(db, dep, env) })),
})

/** 读取某个 Key 在指定环境的实时发布视图（来源环境取 flags 表，其余取 envStates） */
export const getLiveView = (db: Database, key: string, env: Environment): EnvRuntimeState => {
  const flag = representativeFlag(db, key)
  if (flag?.environment === env) return viewFromFlag(db, flag, env)
  const state = envStateOf(db, key, env)
  if (state) {
    const deps = flag?.dependencies ?? state.dependencies ?? []
    return {
      ...structuredClone(state),
      dependencies: structuredClone(deps),
      dependencyStates: deps.map((dep) => ({ flagId: dep.flagId, ...dependencyStateFor(db, dep, env) })),
    }
  }
  if (flag) {
    return {
      key,
      env,
      enabled: false,
      status: 'frozen',
      percentage: 0,
      audienceRules: [],
      minClientVersion: flag.minClientVersion[env],
      stageLabel: '未开始灰度',
      stageSteps: [],
      dependencies: structuredClone(flag.dependencies),
      dependencyStates: flag.dependencies.map((dep) => ({ flagId: dep.flagId, ...dependencyStateFor(db, dep, env) })),
    }
  }
  throw new Error('功能开关不存在')
}

/* ------------------------------ 审计 ------------------------------ */

const appendAudit = (
  db: Database,
  event: {
    flagId: string
    flagKey: string
    action: AuditAction
    actor: string
    summary: string
    before?: string
    after?: string
    batchId?: string
    env?: Environment
    affectedUsers?: number
    createdAt?: string
  },
): void => {
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
    affectedUsers: 0,
    createdAt: now(),
    ...event,
  })
}

const batchImpact = (snapshots: EnvSnapshot[]): number =>
  snapshots.reduce((sum, snapshot) => sum + Math.round(envWeight[snapshot.env] * (snapshot.percentage / 100)), 0)

const addHistory = (batch: ReleaseBatch, label: string, detail: string, actor = ACTOR, tone: BatchTimelineEvent['tone'] = 'info'): void => {
  batch.history.unshift({ at: now(), actor, label, detail, tone })
}

/* ------------------------------ 快照与依赖锁 ------------------------------ */

const buildSnapshot = (db: Database, key: string, env: Environment, source: boolean, percentageOverride?: number): EnvSnapshot => {
  const view = getLiveView(db, key, env)
  const sourceView = source ? view : getLiveView(db, key, db.flags.find((flag) => flag.key === key)!.environment)
  return {
    env,
    source,
    enabled: view.enabled,
    percentage: percentageOverride ?? view.percentage,
    // 下游环境未放量时受众为空，发布批次沿用来源环境锁定的受众规则
    audienceRules: structuredClone(view.audienceRules.length > 0 ? view.audienceRules : sourceView.audienceRules),
    minClientVersion: view.minClientVersion,
    stageLabel: view.stageLabel,
    stageSteps: structuredClone(source ? view.stageSteps : sourceView.stageSteps),
    sourceFingerprint: fingerprintView(view),
  }
}

const buildDependencyLocks = (db: Database, key: string): DependencySnapshot[] => {
  const flag = representativeFlag(db, key)
  if (!flag) return []
  return flag.dependencies.map((dep) => {
    const depFlag = db.flags.find((item) => item.id === dep.flagId)
    const envStates = Object.fromEntries(
      ENV_ORDER.map((env) => {
        const state = dependencyStateFor(db, dep, env)
        return [env, state]
      }),
    ) as DependencySnapshot['envStates']
    return {
      flagId: dep.flagId,
      key: depFlag?.key ?? dep.flagId,
      name: depFlag?.name ?? dep.flagId,
      type: dep.type,
      condition: dep.condition,
      envStates,
    }
  })
}

const batchEnvs = (batch: ReleaseBatch): Environment[] =>
  ENV_ORDER.filter((env) => env === batch.sourceEnv || batch.targetEnvs.includes(env))

/* ------------------------------ 漂移检测 ------------------------------ */

/** 收集确认期间，任一批次环境的来源配置发生改动 → 候选失效 */
const detectDrift = (db: Database, batch: ReleaseBatch): string | undefined => {
  for (const snapshot of batch.snapshots) {
    const view = getLiveView(db, batch.key, snapshot.env)
    if (fingerprintView(view) !== snapshot.sourceFingerprint) {
      return `${envLabel[snapshot.env]}环境的来源配置在批准前被改动（受众、依赖开关、最低版本或灰度阶段与锁定快照不一致）`
    }
  }
  return undefined
}

const invalidateBatch = (db: Database, batch: ReleaseBatch, reason: string, actor: string): void => {
  batch.status = 'invalidated'
  batch.invalidatedReason = reason
  batch.invalidatedAt = now()
  addHistory(batch, '候选失效', reason, actor, 'error')
  const flag = representativeFlag(db, batch.key)
  appendAudit(db, {
    flagId: flag?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-invalidated',
    actor,
    summary: `批次 ${batch.id} 失效：${reason}`,
    before: 'collecting',
    after: 'invalidated',
    batchId: batch.id,
    affectedUsers: batchImpact(batch.snapshots),
  })
}

/** flags 表发生保存/审批/回滚后调用：让对应 Key 的收集中批次立即失效 */
export const invalidateBatchesForKey = (db: Database, key: string, actor: string): void => {
  for (const batch of db.batches) {
    if (batch.key === key && batch.status === 'collecting') {
      const reason = detectDrift(db, batch)
      if (reason) invalidateBatch(db, batch, reason, actor)
    }
  }
}

const lazyValidate = (db: Database, batch: ReleaseBatch): ReleaseBatch => {
  if (batch.status === 'collecting') {
    const reason = detectDrift(db, batch)
    if (reason) invalidateBatch(db, batch, reason, '系统巡检')
  }
  return batch
}

/* ------------------------------ 发布前闸门 ------------------------------ */

const evaluateGates = (db: Database, batch: ReleaseBatch): BatchBlocker[] => {
  const blockers: BatchBlocker[] = []
  const envs = batchEnvs(batch)
  const lockedOf = (env: Environment) => batch.snapshots.find((snapshot) => snapshot.env === env)!

  // 闸门 1：依赖开关被回滚或关闭
  for (const env of envs) {
    const view = getLiveView(db, batch.key, env)
    for (const dep of view.dependencyStates) {
      const lock = batch.dependencyLocks.find((item) => item.flagId === dep.flagId)
      if (lock?.type !== 'requires') continue
      if (dep.status === 'rolled-back' || !dep.enabled) {
        const previous = batch.blockers.find((item) => item.id === `dependency-rolled-back:${env}:${dep.flagId}`)
        blockers.push({
          id: `dependency-rolled-back:${env}:${dep.flagId}`,
          type: 'dependency-rolled-back',
          env,
          title: `${envLabel[env]}依赖开关已回滚：${lock?.name ?? dep.flagId}`,
          detail: `依赖「${lock?.name ?? dep.flagId}」在${envLabel[env]}环境当前为 ${dep.status === 'rolled-back' ? '已回滚' : '已关闭'} / ${dep.percentage}%，批次锁定时为 ${lock?.envStates[env].status ?? 'active'} / ${lock?.envStates[env].percentage ?? 100}%。`,
          suggestion: `恢复「${lock?.name ?? dep.flagId}」在${envLabel[env]}的开关与灰度，再重新校验批次。`,
          resolvedLabel: previous?.resolvedLabel,
        })
      }
    }
  }

  // 闸门 2：最低客户端版本不足（环境已发布客户端基线低于锁定门槛）
  for (const env of envs) {
    const snapshot = lockedOf(env)
    const baseline = db.clientBaselines[env]
    if (compareVersion(baseline, snapshot.minClientVersion) < 0) {
      const previous = batch.blockers.find((item) => item.id === `client-version:${env}`)
      blockers.push({
        id: `client-version:${env}`,
        type: 'client-version',
        env,
        title: `${envLabel[env]}客户端基线 ${baseline} 低于锁定门槛 ${snapshot.minClientVersion}`,
        detail: `批次锁定最低客户端版本 ${snapshot.minClientVersion}，${envLabel[env]}环境当前外放基线仅为 ${baseline}，低版本用户无法命中新逻辑。`,
        suggestion: `推动客户端基线提升，或将${envLabel[env]}基线同步到 ${snapshot.minClientVersion} 后继续。`,
        resolvedLabel: previous?.resolvedLabel,
      })
    }
  }

  // 闸门 3：多环境灰度顺序冲突（前一环境实时流量不得低于后一环境的锁定阶段）
  for (let i = 1; i < envs.length; i += 1) {
    const prevEnv = envs[i - 1]
    const env = envs[i]
    const livePrev = getLiveView(db, batch.key, prevEnv).percentage
    const target = lockedOf(env).percentage
    if (livePrev < target) {
      const previous = batch.blockers.find((item) => item.id === `rollout-order:${prevEnv}:${env}`)
      blockers.push({
        id: `rollout-order:${prevEnv}:${env}`,
        type: 'rollout-order',
        env,
        title: `灰度顺序冲突：${envLabel[prevEnv]} ${livePrev}% 低于${envLabel[env]}锁定阶段 ${target}%`,
        detail: `${envLabel[env]}计划放到 ${target}%，但上游${envLabel[prevEnv]}实时仅 ${livePrev}%，整批不能跨过上游放量。`,
        suggestion: `先把${envLabel[prevEnv]}灰度对齐到 ${target}%（或调低${envLabel[env]}目标阶段）后重新校验。`,
        resolvedLabel: previous?.resolvedLabel,
      })
    }
  }

  return blockers
}

const runGates = (db: Database, batch: ReleaseBatch, actor: string): void => {
  const blockers = evaluateGates(db, batch)
  batch.blockers = blockers
  batch.evaluatedAt = now()
  if (blockers.length === 0) {
    if (batch.status === 'blocked') {
      batch.status = 'ready'
      // 阻断修复后保留各环境确认项，无需重新批准
      batch.confirmations = batch.confirmations.map((item) => ({ ...item, retained: true }))
      addHistory(batch, '闸门通过', '阻断项已修复，原各环境确认项保留，可直接发布。', actor, 'success')
      appendAudit(db, {
        flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
        flagKey: batch.key,
        action: 'batch-resolved',
        actor,
        summary: `批次 ${batch.id} 阻断项全部解除，恢复到待发布。`,
        before: 'blocked',
        after: 'ready',
        batchId: batch.id,
        affectedUsers: batchImpact(batch.snapshots),
      })
    }
    return
  }
  const wasBlocked = batch.status === 'blocked'
  batch.status = 'blocked'
  addHistory(
    batch,
    wasBlocked ? '重新校验未通过' : '整批停在待处理',
    `发布前闸门发现 ${blockers.length} 个阻断项：${blockers.map((item) => item.title).join('；')}`,
    actor,
    'warning',
  )
  if (!wasBlocked) {
    appendAudit(db, {
      flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
      flagKey: batch.key,
      action: 'batch-blocked',
      actor,
      summary: `批次 ${batch.id} 发布被阻断：${blockers.map((item) => item.title).join('；')}`,
      before: 'ready',
      after: 'blocked',
      batchId: batch.id,
      affectedUsers: batchImpact(batch.snapshots),
    })
  }
}

/* ------------------------------ 查询 ------------------------------ */

export const listBatches = (): ReleaseBatch[] => {
  const db = readDatabase()
  let changed = false
  for (const batch of db.batches) {
    const before = batch.status
    lazyValidate(db, batch)
    if (batch.status !== before) changed = true
  }
  if (changed) writeDatabase(db)
  return structuredClone(db.batches)
}

export const getBatch = (id: string): ReleaseBatch | undefined => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) return undefined
  const before = batch.status
  lazyValidate(db, batch)
  if (batch.status !== before) writeDatabase(db)
  return structuredClone(batch)
}

export const getBatchLiveViews = (batch: ReleaseBatch): EnvRuntimeState[] => {
  const db = readDatabase()
  return batchEnvs(batch).map((env) => structuredClone(getLiveView(db, batch.key, env)))
}

/* ------------------------------ 建批次 ------------------------------ */

let batchSequence = 100

const assembleBatch = (
  db: Database,
  payload: CreateBatchPayload & { id?: string; createdAt?: string },
  targetPercentages?: Partial<Record<Environment, number>>,
): ReleaseBatch => {
  const flag = representativeFlag(db, payload.flagId ? db.flags.find((item) => item.id === payload.flagId)!.key : '')
  if (!flag) throw new Error('功能开关不存在')
  if (payload.targetEnvs.includes(payload.sourceEnv)) throw new Error('来源环境不能重复选为目标环境')
  if (payload.targetEnvs.length === 0) throw new Error('至少选择一个目标环境')
  batchSequence += 1
  const id = payload.id ?? `batch-${batchSequence}`
  const envs = ENV_ORDER.filter((env) => env === payload.sourceEnv || payload.targetEnvs.includes(env))
  const snapshots = envs.map((env) =>
    buildSnapshot(db, flag.key, env, env === payload.sourceEnv, targetPercentages?.[env]),
  )
  const batch: ReleaseBatch = {
    id,
    key: flag.key,
    name: flag.name,
    owner: flag.owner,
    team: flag.team,
    sourceEnv: payload.sourceEnv,
    targetEnvs: [...payload.targetEnvs],
    status: 'collecting',
    createdAt: payload.createdAt ?? now(),
    createdBy: payload.createdBy,
    snapshots,
    dependencyLocks: buildDependencyLocks(db, flag.key),
    confirmations: [],
    blockers: [],
    history: [
      {
        at: payload.createdAt ?? now(),
        actor: payload.createdBy,
        label: '创建发布批次',
        detail: `锁定来源环境（${envLabel[payload.sourceEnv]}）、依赖开关、最低客户端版本与灰度阶段，等待各环境批准窗口确认。${payload.note ?? ''}`,
        tone: 'info',
      },
    ],
    dataVersion: 1,
  }
  return batch
}

export const createBatch = (payload: CreateBatchPayload): ReleaseBatch => {
  const db = readDatabase()
  const batch = assembleBatch(db, payload)
  db.batches.unshift(batch)
  const flag = db.flags.find((item) => item.id === payload.flagId)!
  appendAudit(db, {
    flagId: flag.id,
    flagKey: flag.key,
    action: 'batch-created',
    actor: payload.createdBy,
    summary: `创建发布批次 ${batch.id}：来源 ${envLabel[payload.sourceEnv]}，目标 ${payload.targetEnvs.map((env) => envLabel[env]).join('、')}，锁定 ${batch.snapshots.length} 套环境快照与 ${batch.dependencyLocks.length} 个依赖开关。`,
    after: 'collecting',
    batchId: batch.id,
  })
  writeDatabase(db)
  return structuredClone(batch)
}

/** 失效/被取代的旧批次可基于当前实时配置重建，旧状态与审计仍保留 */
export const rebuildBatch = (id: string, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const old = db.batches.find((item) => item.id === id)
  if (!old) throw new Error('批次不存在')
  if (!['invalidated', 'superseded'].includes(old.status)) throw new Error('仅失效或被取代的批次可以重建')
  const flagId = representativeFlag(db, old.key)?.id ?? old.key
  const next = assembleBatch(db, {
    flagId,
    sourceEnv: old.sourceEnv,
    targetEnvs: old.targetEnvs,
    createdBy: actor,
  })
  db.batches.unshift(next)
  appendAudit(db, {
    flagId,
    flagKey: old.key,
    action: 'batch-rebuilt',
    actor,
    summary: `批次 ${old.id} 已失效，基于当前实时配置重建为 ${next.id}，旧批次与审计记录保留可查。`,
    before: old.id,
    after: next.id,
    batchId: next.id,
    affectedUsers: batchImpact(next.snapshots),
  })
  addHistory(next, '由失效批次重建', `来源批次 ${old.id} 的确认项不再保留，需重新走批准窗口。`, actor, 'info')
  writeDatabase(db)
  return structuredClone(next)
}

/* ------------------------------ 批准窗口 ------------------------------ */

const finalizeConfirmations = (db: Database, batch: ReleaseBatch, actor: string): void => {
  runGates(db, batch, actor)
  if (batch.status !== 'blocked') {
    batch.status = 'ready'
    addHistory(batch, '全部环境批准完成', '所有确认窗口已通过且发布前闸门无阻断，等待发布。', actor, 'success')
  }
  const ordered = [...batch.confirmations].sort((a, b) => ENV_ORDER.indexOf(a.env) - ENV_ORDER.indexOf(b.env))
  const lastEnv = ordered.at(-1)!.env
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-confirmed',
    actor,
    summary: `批次 ${batch.id} 完成最后批准（${envLabel[lastEnv]}窗口），当前状态：${batch.status === 'blocked' ? '停在待处理' : '待发布'}。`,
    before: 'collecting',
    after: batch.status,
    batchId: batch.id,
    affectedUsers: batchImpact(batch.snapshots),
  })
}

/** 单个确认窗口批准；最后一个窗口批准时立即过闸门 */
export const confirmBatchEnv = (id: string, env: Environment, actor: string, comment?: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('批次不存在')
  lazyValidate(db, batch)
  if (batch.status !== 'collecting') throw new Error('当前批次不在批准阶段')
  if (batch.confirmations.some((item) => item.env === env)) throw new Error('该环境窗口已批准')

  // 确认瞬间再做一次漂移校验
  const drift = detectDrift(db, batch)
  if (drift) {
    invalidateBatch(db, batch, drift, actor)
    writeDatabase(db)
    throw new Error('来源配置刚被改动，候选批次已失效')
  }

  batch.confirmations.push({ env, actor, confirmedAt: now(), retained: false })
  batch.dataVersion += 1
  addHistory(batch, `${envLabel[env]}窗口批准`, comment || `${actor} 在${envLabel[env]}确认窗口锁定配置无误。`, actor, 'success')
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-confirmed',
    actor,
    summary: `${envLabel[env]}环境批准批次 ${batch.id}（${batch.confirmations.length}/${batch.snapshots.length}）。`,
    batchId: batch.id,
    env,
  })

  if (batch.confirmations.length === batch.snapshots.length) finalizeConfirmations(db, batch, actor)
  writeDatabase(db)
  return structuredClone(batch)
}

/**
 * 两个窗口同时批准同一 Key 的两个候选批次：
 * 以 CAS 方式原子裁决，只保留创建更早的候选有效，另一个标记为 superseded。
 */
export const dualApprove = (actor: string): { winner: ReleaseBatch; loser: ReleaseBatch } => {
  const db = readDatabase()
  const pending = (batch: ReleaseBatch) =>
    batchEnvs(batch).filter((env) => !batch.confirmations.some((item) => item.env === env))

  // 找到同一 Key 下、各自仅剩一个待批准环境的两个收集中批次
  const candidates = db.batches.filter(
    (batch) => batch.status === 'collecting' && pending(batch).length === 1,
  )
  const grouped = new Map<string, ReleaseBatch[]>()
  for (const batch of candidates) {
    const list = grouped.get(batch.key) ?? []
    list.push(batch)
    grouped.set(batch.key, list)
  }
  const pair = [...grouped.values()].find((list) => list.length >= 2)
  if (!pair) throw new Error('没有可模拟双窗口同时批准的候选批次')
  const sorted = [...pair].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const [winner, loser] = [sorted[0], sorted[1]]

  // 原子提交两个“同时发生”的确认
  for (const batch of [winner, loser]) {
    lazyValidate(db, batch)
  }
  if (winner.status !== 'collecting' || loser.status !== 'collecting') {
    throw new Error('其中一个候选已失效，无法同时批准')
  }
  const winnerEnv = pending(winner)[0]
  const loserEnv = pending(loser)[0]
  winner.confirmations.push({ env: winnerEnv, actor, confirmedAt: now(), retained: false })
  loser.confirmations.push({ env: loserEnv, actor, confirmedAt: now(), retained: false })
  winner.dataVersion += 1
  loser.dataVersion += 1

  // 裁决：只保留一个有效批次
  loser.status = 'superseded'
  loser.supersededBy = winner.id
  addHistory(loser, '候选被取代', `两个确认窗口同时完成同一 Key 的最终批准，裁决保留 ${winner.id}，本批次作废。`, actor, 'error')
  appendAudit(db, {
    flagId: representativeFlag(db, loser.key)?.id ?? loser.key,
    flagKey: loser.key,
    action: 'batch-superseded',
    actor,
    summary: `批次 ${loser.id} 与 ${winner.id} 的批准窗口同时完成，按创建先后裁决，仅保留 ${winner.id} 一个有效批次。`,
    before: 'collecting',
    after: 'superseded',
    batchId: loser.id,
    affectedUsers: batchImpact(loser.snapshots),
  })

  finalizeConfirmations(db, winner, actor)
  writeDatabase(db)
  return { winner: structuredClone(winner), loser: structuredClone(loser) }
}

/* ------------------------------ 阻断修复 ------------------------------ */

const persistEnvLive = (db: Database, key: string, env: Environment, patch: Partial<EnvRuntimeState>, actor: string, note: string): void => {
  const flag = representativeFlag(db, key)
  if (flag && flag.environment === env) {
    if (patch.percentage !== undefined) flag.rolloutPercentage = patch.percentage
    if (patch.enabled !== undefined) flag.enabled = patch.enabled
    if (patch.status !== undefined) {
      flag.status = patch.status === 'rolled-back' ? 'rolled-back' : patch.status
    }
    if (patch.audienceRules) flag.audienceRules = structuredClone(patch.audienceRules)
    if (patch.minClientVersion !== undefined) flag.minClientVersion[env] = patch.minClientVersion
    if (patch.stageSteps) flag.rolloutSteps = structuredClone(patch.stageSteps)
    flag.updatedAt = now()
    flag.lastChangedBy = actor
  } else {
    const index = db.envStates.findIndex((state) => state.key === key && state.env === env)
    const base: EnvRuntimeState = getLiveView(db, key, env)
    const next: EnvRuntimeState = { ...base, ...structuredClone(patch) } as EnvRuntimeState
    if (index >= 0) db.envStates[index] = next
    else db.envStates.push(next)
  }
  appendAudit(db, {
    flagId: flag?.id ?? key,
    flagKey: key,
    action: 'env-changed',
    actor,
    summary: note,
    env,
  })
}

export const revalidateBatch = (id: string, actor = ACTOR): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('批次不存在')
  if (!['blocked', 'ready'].includes(batch.status)) throw new Error('仅待处理/待发布批次可以重新校验')
  runGates(db, batch, actor)
  writeDatabase(db)
  return structuredClone(batch)
}

/** 修复：恢复被回滚的依赖开关 */
export const resolveDependency = (id: string, blockerId: string, actor = ACTOR): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch || batch.status !== 'blocked') throw new Error('批次不在待处理状态')
  const blocker = batch.blockers.find((item) => item.id === blockerId)
  if (!blocker || blocker.type !== 'dependency-rolled-back') throw new Error('阻断项不存在')
  const depFlagId = blockerId.split(':').pop()!
  const depFlag = db.flags.find((item) => item.id === depFlagId)
  if (!depFlag) throw new Error('依赖开关不存在')
  const lock = batch.dependencyLocks.find((item) => item.flagId === depFlagId)!
  const lockedState = lock.envStates[blocker.env]
  const liveBefore = getLiveView(db, depFlag.key, blocker.env)
  // 留存修复前的依赖状态，整批回滚时恢复
  batch.dependencyRestore = [
    ...(batch.dependencyRestore ?? []).filter(
      (item) => !(item.env === blocker.env && item.flagId === depFlagId),
    ),
    { env: blocker.env, flagId: depFlagId, enabled: liveBefore.enabled, status: liveBefore.status, percentage: liveBefore.percentage },
  ]
  persistEnvLive(
    db,
    depFlag.key,
    blocker.env,
    { enabled: true, status: 'active', percentage: Math.max(lockedState.percentage, 100) },
    actor,
    `批次 ${id} 修复依赖回滚：恢复 ${depFlag.name} 在${envLabel[blocker.env]}的开关（${Math.max(lockedState.percentage, 100)}%）。`,
  )
  blocker.resolvedLabel = `已于 ${now().slice(0, 16).replace('T', ' ')} 恢复依赖开关`
  addHistory(batch, '修复依赖回滚', `${depFlag.name} 在${envLabel[blocker.env]}已恢复，确认项继续保留。`, actor, 'success')
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-resolved',
    actor,
    summary: `批次 ${id} 恢复依赖 ${depFlag.key}（${envLabel[blocker.env]}）。`,
    batchId: id,
    env: blocker.env,
  })
  runGates(db, batch, actor)
  writeDatabase(db)
  return structuredClone(batch)
}

/** 修复：把环境客户端基线同步到锁定门槛 */
export const syncClientBaseline = (id: string, blockerId: string, actor = ACTOR): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch || batch.status !== 'blocked') throw new Error('批次不在待处理状态')
  const blocker = batch.blockers.find((item) => item.id === blockerId)
  if (!blocker || blocker.type !== 'client-version') throw new Error('阻断项不存在')
  const snapshot = batch.snapshots.find((item) => item.env === blocker.env)!
  const before = db.clientBaselines[blocker.env]
  db.clientBaselines[blocker.env] = snapshot.minClientVersion
  blocker.resolvedLabel = `基线已于 ${now().slice(0, 16).replace('T', ' ')} 同步到 ${snapshot.minClientVersion}`
  addHistory(batch, '同步客户端基线', `${envLabel[blocker.env]}基线 ${before} → ${snapshot.minClientVersion}，确认项继续保留。`, actor, 'success')
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-resolved',
    actor,
    summary: `批次 ${id} 将${envLabel[blocker.env]}客户端基线同步至 ${snapshot.minClientVersion}。`,
    before,
    after: snapshot.minClientVersion,
    batchId: id,
    env: blocker.env,
  })
  runGates(db, batch, actor)
  writeDatabase(db)
  return structuredClone(batch)
}

/** 修复：把上游环境实时灰度对齐到下游锁定阶段 */
export const alignRolloutOrder = (id: string, blockerId: string, actor = ACTOR): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch || batch.status !== 'blocked') throw new Error('批次不在待处理状态')
  const blocker = batch.blockers.find((item) => item.id === blockerId)
  if (!blocker || blocker.type !== 'rollout-order') throw new Error('阻断项不存在')
  const [, prevEnv, targetEnv] = blockerId.split(':') as [string, Environment, Environment]
  const target = batch.snapshots.find((item) => item.env === targetEnv)!.percentage
  const view = getLiveView(db, batch.key, prevEnv)
  const steps: RolloutStep[] = view.stageSteps.length
    ? view.stageSteps.map((step) =>
        step.status === 'running' ? { ...step, percentage: target, status: 'running' } : step,
      )
    : [{ id: `s-aligned-${Date.now()}`, percentage: target, audience: `对齐下游批次阶段`, startedAt: now(), status: 'running', guardrails: ['批次顺序对齐'] }]
  persistEnvLive(
    db,
    batch.key,
    prevEnv,
    { percentage: target, enabled: true, status: 'active', stageSteps: steps, stageLabel: `对齐${envLabel[targetEnv]}阶段 ${target}%` },
    actor,
    `批次 ${id} 修复灰度顺序：${envLabel[prevEnv]}实时灰度对齐到 ${target}%。`,
  )
  blocker.resolvedLabel = `${envLabel[prevEnv]}已于 ${now().slice(0, 16).replace('T', ' ')} 对齐到 ${target}%`
  addHistory(batch, '对齐灰度顺序', `${envLabel[prevEnv]}实时灰度已提升至 ${target}%，确认项继续保留。`, actor, 'success')
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-resolved',
    actor,
    summary: `批次 ${id} 将${envLabel[prevEnv]}灰度对齐至 ${target}%。`,
    before: `${view.percentage}%`,
    after: `${target}%`,
    batchId: id,
    env: prevEnv,
  })
  runGates(db, batch, actor)
  writeDatabase(db)
  return structuredClone(batch)
}

/* ------------------------------ 发布 ------------------------------ */

/** 发布时让各环境锁定比例满足 dev ≤ … ≤ production 的单调约束 */
const effectivePercentages = (batch: ReleaseBatch): Array<{ env: Environment; percentage: number }> => {
  const envs = batchEnvs(batch)
  const values = envs.map((env) => batch.snapshots.find((snapshot) => snapshot.env === env)!.percentage)
  for (let i = values.length - 2; i >= 0; i -= 1) {
    values[i] = Math.max(values[i], values[i + 1])
  }
  return envs.map((env, index) => ({ env, percentage: values[index] }))
}

export const publishBatch = (id: string, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('批次不存在')
  lazyValidate(db, batch)
  if (!['ready', 'blocked'].includes(batch.status)) throw new Error('当前批次不可发布')
  runGates(db, batch, actor)
  if (batch.blockers.length > 0) throw new Error('仍有发布阻断项未处理')

  // 1. 留存发布前还原点（受众 / 依赖 / 灰度阶段）
  const envs = batchEnvs(batch)
  const restoredDeps = batch.dependencyRestore ?? []
  const restorePoints: RestorePoint[] = envs.map((env) => {
    const view = getLiveView(db, batch.key, env)
    return {
      env,
      enabled: view.enabled,
      percentage: view.percentage,
      audienceRules: structuredClone(view.audienceRules),
      stageLabel: view.stageLabel,
      stageSteps: structuredClone(view.stageSteps),
      // 发布前为解阻而恢复的依赖，还原点记录修复前状态；其余依赖取实时状态
      dependencyStates: structuredClone(
        view.dependencyStates.map((dep) => {
          const saved = restoredDeps.find((item) => item.env === env && item.flagId === dep.flagId)
          return saved ?? dep
        }),
      ),
    }
  })

  // 2. 同 Key 其它收集中候选整批作废（只允许一个有效批次进入发布）
  for (const sibling of db.batches) {
    if (sibling.key === batch.key && sibling.id !== batch.id && sibling.status === 'collecting') {
      sibling.status = 'superseded'
      sibling.supersededBy = batch.id
      addHistory(sibling, '候选被取代', `批次 ${batch.id} 已完成发布，本候选批次作废。`, actor, 'error')
      appendAudit(db, {
        flagId: representativeFlag(db, sibling.key)?.id ?? sibling.key,
        flagKey: sibling.key,
        action: 'batch-superseded',
        actor,
        summary: `批次 ${sibling.id} 因同 Key 批次 ${batch.id} 发布而作废。`,
        before: 'collecting',
        after: 'superseded',
        batchId: sibling.id,
      })
    }
  }

  // 3. 逐环境写入锁定配置（受众、最低版本、灰度阶段）
  const percentages = effectivePercentages(batch)
  for (const { env, percentage } of percentages) {
    const snapshot = batch.snapshots.find((item) => item.env === env)!
    const steps = structuredClone(snapshot.stageSteps)
    if (steps.length) {
      const lastRunning = [...steps].reverse().find((step) => step.status === 'running' || step.status === 'planned')
      if (lastRunning) {
        lastRunning.status = 'running'
        lastRunning.percentage = percentage
      }
    }
    persistEnvLive(
      db,
      batch.key,
      env,
      {
        enabled: true,
        status: 'active',
        percentage,
        audienceRules: structuredClone(snapshot.audienceRules),
        minClientVersion: snapshot.minClientVersion,
        stageLabel: snapshot.stageLabel,
        stageSteps: steps,
      },
      actor,
      `批次 ${batch.id} 发布到${envLabel[env]}：灰度 ${percentage}%，应用锁定受众与最低客户端版本。`,
    )
  }

  batch.status = 'published'
  batch.publishedAt = now()
  batch.publishedBy = actor
  batch.restorePoints = restorePoints
  batch.confirmations = batch.confirmations.map((item) => ({ ...item, retained: true }))
  addHistory(batch, '批次发布', `按 ${envs.map((env) => envLabel[env]).join(' → ')} 顺序整批写入锁定配置。`, actor, 'success')
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-published',
    actor,
    summary: `批次 ${batch.id} 整批发布完成，涉及 ${envs.map((env) => envLabel[env]).join('、')}，发布前状态已留存为还原点。`,
    before: 'ready',
    after: 'published',
    batchId: batch.id,
    affectedUsers: batchImpact(batch.snapshots),
  })
  writeDatabase(db)
  return structuredClone(batch)
}

/* ------------------------------ 整批回滚 ------------------------------ */

export const rollbackBatch = (id: string, actor: string, reason: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('批次不存在')
  if (batch.status !== 'published') throw new Error('仅已发布批次可以整批回滚')
  if (!batch.restorePoints) throw new Error('缺少发布时的还原点')

  for (const point of batch.restorePoints) {
    // 恢复受众与灰度阶段
    persistEnvLive(
      db,
      batch.key,
      point.env,
      {
        enabled: point.enabled,
        status: point.enabled ? 'active' : 'frozen',
        percentage: point.percentage,
        audienceRules: structuredClone(point.audienceRules),
        stageLabel: point.stageLabel,
        stageSteps: structuredClone(point.stageSteps),
      },
      actor,
      `批次 ${batch.id} 整批回滚：恢复${envLabel[point.env]}发布前的受众与灰度阶段（${point.percentage}%）。`,
    )
    // 一并恢复依赖开关当时状态
    for (const depState of point.dependencyStates) {
      const depFlag = db.flags.find((item) => item.id === depState.flagId)
      if (!depFlag) continue
      const current = getLiveView(db, depFlag.key, point.env)
      if (current.enabled === depState.enabled && current.status === depState.status && current.percentage === depState.percentage) continue
      persistEnvLive(
        db,
        depFlag.key,
        point.env,
        { enabled: depState.enabled, status: depState.status, percentage: depState.percentage },
        actor,
        `批次 ${batch.id} 整批回滚：恢复依赖 ${depFlag.name} 在${envLabel[point.env]}的开关状态（${depState.status} / ${depState.percentage}%）。`,
      )
    }
  }

  batch.status = 'rolled-back'
  batch.rolledBackAt = now()
  batch.rolledBackBy = actor
  batch.rollbackReason = reason
  addHistory(batch, '整批回滚', reason, actor, 'error')
  appendAudit(db, {
    flagId: representativeFlag(db, batch.key)?.id ?? batch.key,
    flagKey: batch.key,
    action: 'batch-reverted',
    actor,
    summary: `批次 ${batch.id} 整批回滚：${reason}；受众、依赖开关与灰度阶段已恢复到发布前状态。`,
    before: 'published',
    after: 'rolled-back',
    batchId: batch.id,
    affectedUsers: batchImpact(batch.snapshots),
  })
  writeDatabase(db)
  return structuredClone(batch)
}

/* ------------------------------ 模拟环境改动（演示失效） ------------------------------ */

export const simulateEnvChange = (id: string, env: Environment, actor: string): ReleaseBatch => {
  const db = readDatabase()
  const batch = db.batches.find((item) => item.id === id)
  if (!batch) throw new Error('批次不存在')
  const view = getLiveView(db, batch.key, env)
  const nextPercentage = Math.min(100, Math.max(0, view.percentage + (view.percentage >= 50 ? -10 : 10)))
  persistEnvLive(
    db,
    batch.key,
    env,
    { percentage: nextPercentage, stageLabel: `临时调整 ${nextPercentage}%（未经批次）` },
    actor,
    `${actor} 绕过批次单独调整了${envLabel[env]}灰度（${view.percentage}% → ${nextPercentage}%）。`,
  )
  invalidateBatchesForKey(db, batch.key, actor)
  writeDatabase(db)
  return structuredClone(batch)
}

/* ------------------------------ 种子批次 ------------------------------ */

const confirmationSeed = (env: Environment, actor: string, at: string): BatchConfirmation => ({
  env,
  actor,
  confirmedAt: at,
  retained: false,
})

export const ensureSeedBatches = (db: Database): boolean => {
  if (db.batches.length > 0 || db.flags.length === 0) return false
  const make = (
    spec: {
      id: string
      key: string
      sourceEnv: Environment
      targetEnvs: Environment[]
      createdBy: string
      createdAt: string
      percentages?: Partial<Record<Environment, number>>
    },
  ) =>
    assembleBatch(
      db,
      {
        id: spec.id,
        flagId: db.flags.find((flag) => flag.key === spec.key)!.id,
        sourceEnv: spec.sourceEnv,
        targetEnvs: spec.targetEnvs,
        createdBy: spec.createdBy,
        createdAt: spec.createdAt,
      },
      spec.percentages,
    )

  // B1：三环境已全部批准，发布前停在待处理（依赖回滚 + 版本不足 ×2 + 顺序冲突）
  const b1 = make({
    id: 'batch-001',
    key: 'checkout.express-pay-v2',
    sourceEnv: 'staging',
    targetEnvs: ['dev', 'production'],
    createdBy: '陈思远',
    createdAt: '2026-09-30T08:30:00+08:00',
    percentages: { production: 50 },
  })
  b1.confirmations = [
    confirmationSeed('dev', '韩秋', '2026-09-30T08:45:00+08:00'),
    confirmationSeed('staging', '陈思远', '2026-09-30T09:00:00+08:00'),
    confirmationSeed('production', '林默', '2026-09-30T09:10:00+08:00'),
  ]
  runGates(db, b1, '林默')
  db.batches.push(b1)

  // B2/B3：同 Key 两个候选，各剩一个窗口 → 双窗口同时批准演示
  const b2 = make({
    id: 'batch-002',
    key: 'console.billing-export-v3',
    sourceEnv: 'dev',
    targetEnvs: ['staging', 'production'],
    createdBy: '周航',
    createdAt: '2026-09-30T09:20:00+08:00',
    percentages: { staging: 50, production: 5 },
  })
  b2.confirmations = [
    confirmationSeed('dev', '周航', '2026-09-30T09:28:00+08:00'),
    confirmationSeed('staging', '赵岚', '2026-09-30T09:35:00+08:00'),
  ]
  db.batches.push(b2)

  const b3 = make({
    id: 'batch-003',
    key: 'console.billing-export-v3',
    sourceEnv: 'dev',
    targetEnvs: ['staging', 'production'],
    createdBy: '周航',
    createdAt: '2026-09-30T09:26:00+08:00',
    percentages: { staging: 50, production: 5 },
  })
  b3.confirmations = [
    confirmationSeed('dev', '周航', '2026-09-30T09:31:00+08:00'),
    confirmationSeed('production', '林默', '2026-09-30T09:40:00+08:00'),
  ]
  db.batches.push(b3)

  // B4：已发布批次，可整批回滚
  const b4 = make({
    id: 'batch-004',
    key: 'catalog.smart-recommendation',
    sourceEnv: 'production',
    targetEnvs: ['dev', 'staging'],
    createdBy: '许薇',
    createdAt: '2026-09-28T15:40:00+08:00',
    percentages: { staging: 50 },
  })
  b4.confirmations = ENV_ORDER.map((env, index) =>
    confirmationSeed(env, ['周启', '许薇', '林默'][index], `2026-09-28T1${6 + index}:00:00+08:00`),
  )
  b4.restorePoints = [
    {
      env: 'dev',
      enabled: true,
      percentage: 100,
      audienceRules: [],
      stageLabel: '全部开发流量',
      stageSteps: [],
      dependencyStates: [],
    },
    {
      env: 'staging',
      enabled: true,
      percentage: 35,
      audienceRules: [{ id: 'r-seed-1', attribute: 'user.segment', operator: 'in', value: 'beta', negate: false }],
      stageLabel: '预发灰度 35%',
      stageSteps: [],
      dependencyStates: [],
    },
    {
      env: 'production',
      enabled: true,
      percentage: 35,
      audienceRules: structuredClone(db.flags.find((flag) => flag.key === b4.key)!.audienceRules),
      stageLabel: '活跃及高意图用户',
      stageSteps: structuredClone(db.flags.find((flag) => flag.key === b4.key)!.rolloutSteps),
      dependencyStates: [],
    },
  ]
  b4.status = 'published'
  b4.publishedAt = '2026-09-28T16:40:00+08:00'
  b4.publishedBy = '林默'
  b4.blockers = []
  b4.history.unshift({
    at: '2026-09-28T16:40:00+08:00',
    actor: '林默',
    label: '批次发布',
    detail: '按 开发 → 预发 → 生产 顺序整批写入锁定配置。',
    tone: 'success',
  })
  appendAudit(db, {
    flagId: db.flags.find((flag) => flag.key === b4.key)!.id,
    flagKey: b4.key,
    action: 'batch-published',
    actor: '林默',
    summary: `批次 ${b4.id} 整批发布完成，发布前状态已留存为还原点。`,
    before: 'ready',
    after: 'published',
    batchId: b4.id,
    affectedUsers: batchImpact(b4.snapshots),
    createdAt: '2026-09-28T16:40:00+08:00',
  })
  db.batches.push(b4)

  // B5：批准前被改动而失效的历史批次
  const b5 = make({
    id: 'batch-005',
    key: 'campaign.new-editor',
    sourceEnv: 'production',
    targetEnvs: ['dev', 'staging'],
    createdBy: '梁琪',
    createdAt: '2026-09-27T13:10:00+08:00',
  })
  b5.confirmations = [
    confirmationSeed('dev', '梁琪', '2026-09-27T13:30:00+08:00'),
    confirmationSeed('staging', '梁琪', '2026-09-27T13:45:00+08:00'),
  ]
  b5.status = 'invalidated'
  b5.invalidatedAt = '2026-09-27T14:00:00+08:00'
  b5.invalidatedReason = '生产环境受众在批准前被临时修改，灰度阶段与锁定快照不一致。'
  b5.history.unshift({
    at: '2026-09-27T14:00:00+08:00',
    actor: '沈宁',
    label: '候选失效',
    detail: b5.invalidatedReason,
    tone: 'error',
  })
  appendAudit(db, {
    flagId: db.flags.find((flag) => flag.key === b5.key)!.id,
    flagKey: b5.key,
    action: 'batch-invalidated',
    actor: '沈宁',
    summary: `批次 ${b5.id} 失效：${b5.invalidatedReason}`,
    before: 'collecting',
    after: 'invalidated',
    batchId: b5.id,
    createdAt: '2026-09-27T14:00:00+08:00',
  })
  db.batches.push(b5)

  return true
}
