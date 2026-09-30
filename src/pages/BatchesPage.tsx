import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddCardOutlinedIcon from '@mui/icons-material/AddCardOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PublishedWithChangesOutlinedIcon from '@mui/icons-material/PublishedWithChangesOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined'
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined'
import {
  useAlignOrderBlockerMutation,
  useConfirmBatchMutation,
  useCreateBatchMutation,
  useDualApproveBatchMutation,
  useGetBatchDetailQuery,
  useGetBatchesQuery,
  useGetFlagsQuery,
  usePublishBatchMutation,
  useRebuildBatchMutation,
  useResolveDependencyBlockerMutation,
  useRevalidateBatchMutation,
  useRollbackBatchMutation,
  useSimulateEnvChangeMutation,
  useSyncBaselineBlockerMutation,
} from '@/services/flagApi'
import { BatchStatusChip } from '@/components/BatchStatusChip'
import { envLabel } from '@/services/batches'
import type { BatchBlocker, BatchStatus, Environment, EnvRuntimeState, FeatureFlag, ReleaseBatch } from '@/types'
import { ENV_ORDER } from '@/types'

const ACTOR = '林默'

const statusFilter: Array<{ value: BatchStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'collecting', label: '待批准' },
  { value: 'blocked', label: '待处理' },
  { value: 'ready', label: '待发布' },
  { value: 'published', label: '已发布' },
  { value: 'rolled-back', label: '已回滚' },
  { value: 'invalidated', label: '已失效' },
  { value: 'superseded', label: '已被取代' },
]

const blockerTypeLabel: Record<BatchBlocker['type'], string> = {
  'dependency-rolled-back': '依赖回滚',
  'client-version': '版本不足',
  'rollout-order': '灰度顺序冲突',
}

const envChipColor = (env: Environment): 'primary' | 'secondary' | 'success' =>
  env === 'dev' ? 'secondary' : env === 'staging' ? 'primary' : 'success'

const formatTime = (value?: string) =>
  value ? value.slice(0, 16).replace('T', ' ') : '-'

const stagePercent = (batch: ReleaseBatch, env: Environment) =>
  batch.snapshots.find((snapshot) => snapshot.env === env)?.percentage ?? 0

function ConfirmCell({ batch, env }: { batch: ReleaseBatch; env: Environment }) {
  const confirmation = batch.confirmations.find((item) => item.env === env)
  if (confirmation) {
    return (
      <Tooltip title={`${confirmation.actor} · ${formatTime(confirmation.confirmedAt)}${confirmation.retained ? '（闸门修复后保留）' : ''}`}>
        <Chip
          size="small"
          color="success"
          variant={confirmation.retained ? 'filled' : 'outlined'}
          icon={<CheckCircleOutlineIcon />}
          label={`${envLabel[env]}已批${confirmation.retained ? '·保留' : ''}`}
        />
      </Tooltip>
    )
  }
  return (
    <Chip size="small" variant="outlined" icon={<RadioButtonUncheckedIcon />} label={`${envLabel[env]}待批`} />
  )
}

export function BatchesPage() {
  const { data: batches = [], isLoading } = useGetBatchesQuery()
  const { data: flags = [] } = useGetFlagsQuery({})
  const [status, setStatus] = useState<BatchStatus | ''>('')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseBatch | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' | 'warning' } | null>(null)

  const [confirmBatch, confirmState] = useConfirmBatchMutation()
  const [publishBatch, publishState] = usePublishBatchMutation()
  const [rollbackBatch, rollbackState] = useRollbackBatchMutation()
  const [revalidate, revalidateState] = useRevalidateBatchMutation()
  const [resolveDep, resolveDepState] = useResolveDependencyBlockerMutation()
  const [syncBaseline, syncState] = useSyncBaselineBlockerMutation()
  const [alignOrder, alignState] = useAlignOrderBlockerMutation()
  const [rebuild, rebuildState] = useRebuildBatchMutation()
  const [simulateChange, simulateState] = useSimulateEnvChangeMutation()
  const [dualApprove, dualState] = useDualApproveBatchMutation()

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase()
    return batches.filter(
      (batch) =>
        (!status || batch.status === status) &&
        (!key || batch.key.toLowerCase().includes(key) || batch.name.toLowerCase().includes(key) || batch.id.includes(key)),
    )
  }, [batches, status, keyword])

  const selected = batches.find((batch) => batch.id === selectedId) ?? filtered[0]
  const detailQuery = useGetBatchDetailQuery(selected?.id ?? '', { skip: !selected })

  useEffect(() => {
    if (selectedId && !batches.some((batch) => batch.id === selectedId) && filtered[0]) {
      setSelectedId(filtered[0].id)
    } else if (!selectedId && filtered[0]) {
      setSelectedId(filtered[0].id)
    }
  }, [batches, filtered, selectedId])

  const notify = (text: string, tone: 'success' | 'error' | 'warning' = 'success') => setMessage({ text, tone })

  const onConfirm = async (env: Environment) => {
    if (!selected) return
    try {
      await confirmBatch({ id: selected.id, env, actor: ACTOR }).unwrap()
      notify(`${envLabel[env]}窗口批准成功，确认项已锁定`)
    } catch (error) {
      notify((error as { data?: { message?: string } })?.data?.message ?? '批准失败，候选可能已失效', 'error')
    }
  }

  const onDualApprove = async () => {
    try {
      const result = await dualApprove({ actor: ACTOR }).unwrap()
      setSelectedId(result.winner.id)
      notify(`双窗口同时批准完成：保留有效批次 ${result.winner.id}，${result.loser.id} 已被取代`, 'warning')
    } catch (error) {
      notify((error as { data?: { message?: string } })?.data?.message ?? '双窗口裁决失败', 'error')
    }
  }

  const onPublish = async () => {
    if (!selected) return
    try {
      await publishBatch({ id: selected.id, actor: ACTOR }).unwrap()
      notify('整批发布完成：各环境按锁定快照写入，发布前状态已留存')
    } catch (error) {
      notify((error as { data?: { message?: string } })?.data?.message ?? '发布失败', 'error')
    }
  }

  const onRollback = async () => {
    if (!rollbackTarget || rollbackReason.trim().length < 8) {
      notify('回滚原因至少 8 个字符', 'error')
      return
    }
    try {
      await rollbackBatch({ id: rollbackTarget.id, actor: ACTOR, reason: rollbackReason }).unwrap()
      setRollbackTarget(null)
      setRollbackReason('')
      notify('整批回滚完成：受众、依赖开关与灰度阶段已恢复到发布前状态')
    } catch (error) {
      notify((error as { data?: { message?: string } })?.data?.message ?? '回滚失败', 'error')
    }
  }

  const busy =
    confirmState.isLoading ||
    publishState.isLoading ||
    rollbackState.isLoading ||
    revalidateState.isLoading ||
    resolveDepState.isLoading ||
    syncState.isLoading ||
    alignState.isLoading ||
    rebuildState.isLoading ||
    simulateState.isLoading ||
    dualState.isLoading

  const summary = {
    collecting: batches.filter((batch) => batch.status === 'collecting').length,
    blocked: batches.filter((batch) => batch.status === 'blocked').length,
    ready: batches.filter((batch) => batch.status === 'ready').length,
    published: batches.filter((batch) => batch.status === 'published').length,
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">多环境发布批次</Typography>
          <Typography color="text.secondary">
            同一 Key 的开发、预发、生产收成一批：建批次锁定来源环境、依赖开关、最低客户端版本与灰度阶段；批准前任一环境改动候选失效，双窗口同时批准只保留一个有效批次。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="模拟两个确认窗口同时批准同一 Key 的候选批次（需要存在各剩一个待批环境的同 Key 候选对）">
            <Button variant="outlined" startIcon={<BoltOutlinedIcon />} onClick={() => void onDualApprove()} disabled={busy}>
              模拟双窗口同时批准
            </Button>
          </Tooltip>
          <Button variant="contained" startIcon={<AddCardOutlinedIcon />} onClick={() => setCreateOpen(true)}>
            新建发布批次
          </Button>
        </Stack>
      </Box>

      {message && (
        <Alert
          severity={message.tone}
          onClose={() => setMessage(null)}
          sx={{ mb: 2 }}
        >
          {message.text}
        </Alert>
      )}

      <Box className="batch-summary">
        <Box>
          <Typography variant="caption">批准中批次</Typography>
          <Typography className="summary-value">{summary.collecting}</Typography>
          <Typography variant="caption" color="text.secondary">任一环境改动即失效</Typography>
        </Box>
        <Box>
          <Typography variant="caption">停在待处理</Typography>
          <Typography className="summary-value" color="warning.main">{summary.blocked}</Typography>
          <Typography variant="caption" color="text.secondary">修复后从保留确认项继续</Typography>
        </Box>
        <Box>
          <Typography variant="caption">待发布</Typography>
          <Typography className="summary-value" color="success.main">{summary.ready}</Typography>
          <Typography variant="caption" color="text.secondary">闸门全部通过</Typography>
        </Box>
        <Box>
          <Typography variant="caption">已发布批次</Typography>
          <Typography className="summary-value">{summary.published}</Typography>
          <Typography variant="caption" color="text.secondary">可整批回滚并恢复旧状态</Typography>
        </Box>
      </Box>

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Card sx={{ mb: 2 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>批次 / Key</TableCell>
                <TableCell>来源 → 目标环境（锁定阶段）</TableCell>
                <TableCell>确认窗口</TableCell>
                <TableCell>阻断</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>创建时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((batch) => {
                const envs = ENV_ORDER.filter((env) => env === batch.sourceEnv || batch.targetEnvs.includes(env))
                const active = selected?.id === batch.id
                return (
                  <TableRow
                    key={batch.id}
                    hover
                    selected={active}
                    onClick={() => setSelectedId(batch.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{batch.id}</Typography>
                      <Typography variant="caption" color="text.secondary">{batch.key}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" color={envChipColor(batch.sourceEnv)} label={`来源·${envLabel[batch.sourceEnv]} ${stagePercent(batch, batch.sourceEnv)}%`} />
                        {batch.targetEnvs.map((env) => (
                          <Box key={env} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">→</Typography>
                            <Chip size="small" variant="outlined" color={envChipColor(env)} label={`${envLabel[env]} ${stagePercent(batch, env)}%`} />
                          </Box>
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {envs.map((env) => <ConfirmCell key={env} batch={batch} env={env} />)}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {batch.blockers.length > 0 ? (
                        <Chip size="small" color="warning" icon={<WarningAmberOutlinedIcon />} label={`${batch.blockers.length} 项`} />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell><BatchStatusChip status={batch.status} /></TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{formatTime(batch.createdAt)} · {batch.createdBy}</Typography>
                    </TableCell>
                  </TableRow>
                )
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }} color="text.secondary">没有符合条件的批次</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          label="按 Key / 名称 / 批次号搜索"
          size="small"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          sx={{ width: 320 }}
        />
        <TextField select label="状态" size="small" value={status} onChange={(event) => setStatus(event.target.value as BatchStatus | '')} sx={{ width: 160 }}>
          {statusFilter.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </TextField>
      </Stack>

      {selected && <BatchDetail
        batch={detailQuery.data?.batch ?? selected}
        live={detailQuery.data?.live ?? []}
        busy={busy}
        flagsCount={flags.length}
        onConfirm={onConfirm}
        onPublish={onPublish}
        onRevalidate={async () => {
          try {
            await revalidate({ id: selected.id, actor: ACTOR }).unwrap()
            notify('已按当前实时状态重新校验闸门')
          } catch (error) {
            notify((error as { data?: { message?: string } })?.data?.message ?? '重新校验失败', 'error')
          }
        }}
        onResolveDependency={async (blockerId) => {
          try {
            await resolveDep({ id: selected.id, blockerId, actor: ACTOR }).unwrap()
            notify('依赖开关已恢复，确认项保留，可重新校验')
          } catch (error) {
            notify((error as { data?: { message?: string } })?.data?.message ?? '修复失败', 'error')
          }
        }}
        onSyncBaseline={async (blockerId) => {
          try {
            await syncBaseline({ id: selected.id, blockerId, actor: ACTOR }).unwrap()
            notify('客户端基线已同步到锁定门槛，确认项保留')
          } catch (error) {
            notify((error as { data?: { message?: string } })?.data?.message ?? '同步失败', 'error')
          }
        }}
        onAlignOrder={async (blockerId) => {
          try {
            await alignOrder({ id: selected.id, blockerId, actor: ACTOR }).unwrap()
            notify('上游灰度已对齐，确认项保留，可重新校验')
          } catch (error) {
            notify((error as { data?: { message?: string } })?.data?.message ?? '对齐失败', 'error')
          }
        }}
        onRebuild={async () => {
          try {
            const next = await rebuild({ id: selected.id, actor: ACTOR }).unwrap()
            setSelectedId(next.id)
            notify(`已基于当前实时配置重建批次 ${next.id}，旧批次与审计记录仍可查`)
          } catch (error) {
            notify((error as { data?: { message?: string } })?.data?.message ?? '重建失败', 'error')
          }
        }}
        onSimulateChange={async (env) => {
          try {
            await simulateChange({ id: selected.id, env, actor: '值班同学' }).unwrap()
            notify(`已模拟在${envLabel[env]}单独放行（未走批次），候选批次应已失效`, 'warning')
          } catch (error) {
            notify((error as { data?: { message?: string } })?.data?.message ?? '模拟改动失败', 'error')
          }
        }}
        onRollback={() => setRollbackTarget(selected)}
      />}

      <CreateBatchDialog
        open={createOpen}
        flags={flags}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false)
          setStatus('')
          setSelectedId(id)
          notify('批次已创建：来源环境、依赖开关、最低客户端版本与灰度阶段全部锁定')
        }}
        onError={(text) => notify(text, 'error')}
      />

      <Dialog open={Boolean(rollbackTarget)} onClose={() => setRollbackTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>整批回滚 {rollbackTarget?.id}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            回滚会一起恢复批次发布时各环境的受众规则、依赖开关状态与灰度阶段还原点；历史状态与审计记录仍保留可查。
          </Alert>
          {rollbackTarget?.restorePoints && (
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              {rollbackTarget.restorePoints.map((point) => (
                <Typography key={point.env} variant="body2">
                  • {envLabel[point.env]}恢复到 {point.enabled ? `${point.percentage}% / ${point.stageLabel}` : '关闭 / 未放量'}
                </Typography>
              ))}
            </Stack>
          )}
          <TextField
            label="回滚原因与异常证据"
            multiline
            minRows={3}
            fullWidth
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackTarget(null)}>取消</Button>
          <Button color="error" variant="contained" loading={rollbackState.isLoading} onClick={() => void onRollback()} startIcon={<UndoOutlinedIcon />}>
            执行整批回滚
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

/* ------------------------------ 批次详情 ------------------------------ */

interface DetailProps {
  batch: ReleaseBatch
  live: EnvRuntimeState[]
  busy: boolean
  flagsCount: number
  onConfirm: (env: Environment) => void
  onPublish: () => void
  onRevalidate: () => void
  onResolveDependency: (blockerId: string) => void
  onSyncBaseline: (blockerId: string) => void
  onAlignOrder: (blockerId: string) => void
  onRebuild: () => void
  onSimulateChange: (env: Environment) => void
  onRollback: () => void
}

function BatchDetail(props: DetailProps) {
  const { batch, live, busy } = props
  const envs = ENV_ORDER.filter((env) => env === batch.sourceEnv || batch.targetEnvs.includes(env))
  const confirmedEnvs = new Set(batch.confirmations.map((item) => item.env))
  const pendingEnvs = envs.filter((env) => !confirmedEnvs.has(env))
  const liveMap = new Map(live.map((item) => [item.env, item]))

  return (
    <Card>
      <CardContent>
        <Box className="section-heading">
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <LockOutlinedIcon fontSize="small" color="primary" />
              <Typography variant="h3">{batch.id} · 锁定快照</Typography>
              <BatchStatusChip status={batch.status} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {batch.name}（{batch.key}）· 负责人 {batch.owner} / {batch.team}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            {batch.status === 'collecting' && pendingEnvs.length > 0 && pendingEnvs.map((env) => (
              <Button key={env} size="small" variant="contained" disabled={busy} onClick={() => props.onConfirm(env)}>
                批准{envLabel[env]}窗口
              </Button>
            ))}
            {batch.status === 'blocked' && (
              <Button size="small" variant="contained" color="warning" disabled={busy} startIcon={<PublishedWithChangesOutlinedIcon />} onClick={props.onRevalidate}>
                修复后重新校验
              </Button>
            )}
            {batch.status === 'ready' && (
              <Button size="small" variant="contained" color="success" disabled={busy} startIcon={<PublishedWithChangesOutlinedIcon />} onClick={props.onPublish}>
                整批发布
              </Button>
            )}
            {batch.status === 'published' && (
              <Button size="small" variant="outlined" color="error" disabled={busy} startIcon={<UndoOutlinedIcon />} onClick={props.onRollback}>
                整批回滚
              </Button>
            )}
            {['invalidated', 'superseded'].includes(batch.status) && (
              <Button size="small" variant="outlined" disabled={busy || props.flagsCount === 0} startIcon={<RestartAltOutlinedIcon />} onClick={props.onRebuild}>
                基于当前配置重建批次
              </Button>
            )}
          </Stack>
        </Box>

        {(batch.status === 'invalidated' || batch.status === 'superseded') && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {batch.status === 'invalidated'
              ? `候选已失效：${batch.invalidatedReason ?? '来源配置在批准前被改动'}`
              : `本候选已被批次 ${batch.supersededBy} 取代，同一 Key 只保留一个有效批次。`}
            {' '}旧状态与审计记录仍可查；可基于当前实时配置重建。
          </Alert>
        )}

        {batch.status === 'collecting' && (
          <Alert severity="info" sx={{ mb: 2 }} action={
            <Button size="small" color="inherit" onClick={() => props.onSimulateChange(pendingEnvs[0] ?? batch.sourceEnv)} disabled={busy}>
              模拟在{envLabel[pendingEnvs[0] ?? batch.sourceEnv]}单独改动
            </Button>
          }>
            批准窗口收集中。任一环境的受众、依赖开关、最低版本或灰度阶段再被改动，该候选立即失效，需要重建。
          </Alert>
        )}

        {/* 阻断项 */}
        {batch.blockers.length > 0 && (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="h3" sx={{ mb: 1 }}>
              发布前闸门（{batch.blockers.length} 项阻断，整批停在待处理）
            </Typography>
            <Stack spacing={1}>
              {batch.blockers.map((blocker) => (
                <Box key={blocker.id} className="batch-blocker">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip size="small" color="warning" label={blockerTypeLabel[blocker.type]} />
                      <Typography variant="body2" fontWeight={700}>{blocker.title}</Typography>
                    </Stack>
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                      {blocker.detail}
                    </Typography>
                    <Typography variant="caption" display="block">{blocker.suggestion}</Typography>
                    {blocker.resolvedLabel && <Chip size="small" color="success" sx={{ mt: 0.5 }} label={blocker.resolvedLabel} />}
                  </Box>
                  {!blocker.resolvedLabel && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy || batch.status !== 'blocked'}
                      onClick={() => {
                        if (blocker.type === 'dependency-rolled-back') props.onResolveDependency(blocker.id)
                        if (blocker.type === 'client-version') props.onSyncBaseline(blocker.id)
                        if (blocker.type === 'rollout-order') props.onAlignOrder(blocker.id)
                      }}
                    >
                      {blocker.type === 'dependency-rolled-back'
                        ? '恢复依赖开关'
                        : blocker.type === 'client-version'
                          ? '同步客户端基线'
                          : '对齐上游灰度'}
                    </Button>
                  )}
                </Box>
              ))}
            </Stack>
            {batch.confirmations.length > 0 && (
              <Alert severity="success" sx={{ mt: 1.5 }} icon={<CheckCircleOutlineIcon fontSize="inherit" />}>
                已完成的 {batch.confirmations.length} 个环境确认项会在修复后保留，无需重新批准。
              </Alert>
            )}
          </Box>
        )}

        {/* 各环境：锁定快照 vs 实时 */}
        <Typography variant="h3" sx={{ mb: 1 }}>环境快照与实时对比</Typography>
        <TableContainer sx={{ border: '1px solid #e5e6eb', borderRadius: '7px', mb: 2.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>环境</TableCell>
                <TableCell>锁定灰度阶段</TableCell>
                <TableCell>实时灰度</TableCell>
                <TableCell>锁定最低版本 / 实时基线</TableCell>
                <TableCell>锁定受众</TableCell>
                <TableCell>确认</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {envs.map((env) => {
                const snapshot = batch.snapshots.find((item) => item.env === env)!
                const liveView = liveMap.get(env)
                return (
                  <TableRow key={env}>
                    <TableCell>
                      <Chip size="small" color={envChipColor(env)} label={`${envLabel[env]}${env === batch.sourceEnv ? '·来源' : ''}`} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{snapshot.percentage}% · {snapshot.stageLabel}</Typography>
                    </TableCell>
                    <TableCell>
                      {liveView ? (
                        <Typography variant="body2" color={liveView.percentage === snapshot.percentage ? 'text.primary' : 'warning.main'} fontWeight={700}>
                          {liveView.percentage}%
                          {liveView.status !== 'active' && ` · ${liveView.status === 'frozen' ? '冻结' : '已回滚'}`}
                        </Typography>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" display="block">锁定 {snapshot.minClientVersion}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      {snapshot.audienceRules.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">全量用户</Typography>
                      ) : (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {snapshot.audienceRules.map((rule) => (
                            <Chip
                              key={rule.id}
                              size="small"
                              variant="outlined"
                              label={`${rule.attribute} ${rule.operator} ${rule.value}`}
                            />
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell><ConfirmCell batch={batch} env={env} /></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {/* 依赖锁 */}
        {batch.dependencyLocks.length > 0 && (
          <>
            <Typography variant="h3" sx={{ mb: 1 }}>依赖开关锁定</Typography>
            <Stack spacing={1} sx={{ mb: 2.5 }}>
              {batch.dependencyLocks.map((dep) => (
                <Box key={dep.flagId} className="batch-dependency">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" fontWeight={700}>{dep.name}</Typography>
                      <Chip size="small" variant="outlined" label={dep.type === 'requires' ? '强依赖' : dep.type === 'conflicts' ? '互斥' : '降级'} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{dep.condition}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    {ENV_ORDER.map((env) => {
                      const state = dep.envStates[env]
                      return (
                        <Tooltip key={env} title={`${envLabel[env]}：${state.status === 'rolled-back' ? '已回滚' : state.enabled ? '开启' : '关闭'} / ${state.percentage}%`}>
                          <Chip
                            size="small"
                            color={state.status === 'rolled-back' || !state.enabled ? 'error' : 'success'}
                            variant={state.status === 'rolled-back' || !state.enabled ? 'filled' : 'outlined'}
                            label={`${envLabel[env]} ${state.percentage}%`}
                          />
                        </Tooltip>
                      )
                    })}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </>
        )}

        {/* 灰度阶段锁 */}
        <Typography variant="h3" sx={{ mb: 1 }}>灰度阶段锁定（按来源环境快照）</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2.5 }}>
          {batch.snapshots.find((snapshot) => snapshot.env === batch.sourceEnv)?.stageSteps.map((step) => (
            <Chip
              key={step.id}
              size="small"
              variant={step.status === 'completed' ? 'filled' : 'outlined'}
              color={step.status === 'completed' ? 'success' : step.status === 'running' ? 'primary' : 'default'}
              label={`${step.percentage}% · ${step.audience} · ${step.status === 'completed' ? '已完成' : step.status === 'running' ? '进行中' : step.status === 'paused' ? '暂停' : '计划'}`}
            />
          )) ?? <Typography variant="caption" color="text.secondary">无历史阶段</Typography>}
        </Stack>

        {/* 还原点 */}
        {batch.restorePoints && (
          <>
            <Typography variant="h3" sx={{ mb: 1 }}>发布前还原点（整批回滚时恢复）</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2.5 }}>
              {batch.restorePoints.map((point) => (
                <Chip key={point.env} size="small" variant="outlined" label={`${envLabel[point.env]}：${point.enabled ? `${point.percentage}%` : '关闭'} · ${point.stageLabel}`} />
              ))}
            </Stack>
          </>
        )}

        <Divider sx={{ mb: 1.5 }} />
        <Typography variant="h3" sx={{ mb: 1 }}>批次历史 / 审计轨迹</Typography>
        <List dense disablePadding>
          {batch.history.map((event, index) => (
            <ListItem key={`${event.at}-${index}`} disablePadding sx={{ display: 'grid', gridTemplateColumns: '140px 120px minmax(0,1fr)', gap: 1, py: 0.5 }}>
              <Typography variant="caption" color="text.secondary">{formatTime(event.at)}</Typography>
              <Chip size="small" variant="outlined" color={event.tone === 'error' ? 'error' : event.tone === 'warning' ? 'warning' : event.tone === 'success' ? 'success' : 'default'} label={event.label} />
              <Typography variant="caption">{event.detail}（{event.actor}）</Typography>
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  )
}

/* ------------------------------ 新建批次 ------------------------------ */

function CreateBatchDialog({
  open,
  flags,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean
  flags: FeatureFlag[] | undefined
  onClose: () => void
  onCreated: (id: string) => void
  onError: (message: string) => void
}) {
  const first = flags?.[0]
  const [flagId, setFlagId] = useState(first?.id ?? '')
  const [sourceEnv, setSourceEnv] = useState<Environment>(first?.environment ?? 'dev')
  const [targets, setTargets] = useState<Environment[]>(['staging', 'production'])
  const [note, setNote] = useState('')
  const [createBatch, state] = useCreateBatchMutation()

  const flag = flags?.find((item) => item.id === flagId)
  const availableTargets = ENV_ORDER.filter((env) => env !== sourceEnv)

  useEffect(() => {
    if (!flagId && first) {
      setFlagId(first.id)
      setSourceEnv(first.environment)
      setTargets(ENV_ORDER.filter((env) => env !== first.environment))
    }
  }, [first, flagId])

  const toggleTarget = (env: Environment) => {
    setTargets((current) => (current.includes(env) ? current.filter((item) => item !== env) : [...current, env]))
  }

  const submit = async () => {
    if (!flagId) {
      onError('请选择功能开关')
      return
    }
    if (targets.length === 0) {
      onError('至少选择一个目标环境')
      return
    }
    try {
      const batch = await createBatch({
        flagId,
        sourceEnv,
        targetEnvs: targets,
        createdBy: ACTOR,
        note: note.trim() ? `备注：${note.trim()}` : undefined,
      }).unwrap()
      setNote('')
      onCreated(batch.id)
    } catch (error) {
      onError((error as { data?: { message?: string } })?.data?.message ?? '创建批次失败')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>新建多环境发布批次</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }} icon={<LockOutlinedIcon fontSize="inherit" />}>
          创建瞬间锁定：来源环境、各环境依赖开关、最低客户端版本、受众规则与灰度阶段。批准前这些内容任一环境再改动，候选立即失效。
        </Alert>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel shrink>功能开关（同一 Key）</InputLabel>
          <Select
            label="功能开关（同一 Key）"
            value={flagId}
            onChange={(event) => {
              const next = flags?.find((item) => item.id === event.target.value)
              setFlagId(event.target.value)
              if (next) {
                setSourceEnv(next.environment)
                setTargets(ENV_ORDER.filter((env) => env !== next.environment))
              }
            }}
          >
            {flags?.map((item) => (
              <MenuItem key={item.id} value={item.id}>{item.name} · {item.key}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel shrink>来源环境（锁定快照基准）</InputLabel>
          <Select
            label="来源环境（锁定快照基准）"
            value={sourceEnv}
            onChange={(event) => {
              const env = event.target.value as Environment
              setSourceEnv(env)
              setTargets((current) => current.filter((item) => item !== env))
            }}
          >
            {ENV_ORDER.map((env) => <MenuItem key={env} value={env}>{envLabel[env]}{flag?.environment === env ? '（开关主环境）' : ''}</MenuItem>)}
          </Select>
        </FormControl>
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>目标环境（各自独立批准窗口）</Typography>
          <Stack direction="row" spacing={2}>
            {availableTargets.map((env) => (
              <FormControlLabel
                key={env}
                control={<Checkbox checked={targets.includes(env)} onChange={() => toggleTarget(env)} />}
                label={`${envLabel[env]}环境`}
              />
            ))}
          </Stack>
        </Box>
        <TextField
          label="批次说明（可选）"
          fullWidth
          multiline
          minRows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" loading={state.isLoading} onClick={() => void submit()}>锁定并创建批次</Button>
      </DialogActions>
    </Dialog>
  )
}
