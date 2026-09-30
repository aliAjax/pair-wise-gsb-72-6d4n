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
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  useApproveBatchMutation,
  useConfirmBatchCheckMutation,
  useCreateBatchMutation,
  useGetBatchesQuery,
  useGetFlagsQuery,
  useReleaseBatchMutation,
  useRevalidateBatchMutation,
  useRollbackBatchMutation,
} from '@/services/flagApi'
import { BatchStatusChip } from '@/components/BatchStatusChip'
import type { BatchCheckItem, BatchEnvSnapshot, Environment } from '@/types'
import { environmentLabels } from '@/types'

const checkKindLabel: Record<BatchCheckItem['kind'], string> = {
  dependency: '依赖',
  'client-version': '版本',
  'rollout-order': '顺序',
}

const allEnvironments: Environment[] = ['dev', 'staging', 'production']

const errorMessage = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback

function SnapshotGrid({ entries }: { entries: BatchEnvSnapshot[] }) {
  return (
    <Box className="snapshot-grid">
      {entries.map((entry) => (
        <Box key={entry.environment} className="snapshot-env">
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Chip size="small" color="primary" variant="outlined" label={environmentLabels[entry.environment]} />
            <Typography variant="body2" fontWeight={700}>
              {entry.rolloutPercentage}% · {entry.enabled ? '启用' : '关闭'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block">
            最低客户端版本 {entry.minClientVersion}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            受众规则 {entry.audienceRules.length} 条 · 依赖 {entry.dependencies.length} 条 · 灰度阶段{' '}
            {entry.rolloutSteps.length} 个
          </Typography>
          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            {entry.audienceRules.map((rule) => (
              <Chip
                key={rule.id}
                size="small"
                variant="outlined"
                label={`${rule.attribute} ${rule.operator} ${rule.value}`}
              />
            ))}
            {entry.dependencies.map((dependency) => (
              <Chip
                key={`${dependency.flagId}-${dependency.type}`}
                size="small"
                color={dependency.type === 'conflicts' ? 'error' : 'default'}
                variant="outlined"
                label={`${dependency.type} ${dependency.flagId}`}
              />
            ))}
          </Stack>
          {entry.rolloutSteps.map((step) => (
            <Typography key={step.id} variant="caption" display="block" color="text.secondary">
              · {step.percentage}% {step.audience}（
              {step.status === 'completed'
                ? '已完成'
                : step.status === 'running'
                  ? '进行中'
                  : step.status === 'paused'
                    ? '已暂停'
                    : '计划中'}
              ）
            </Typography>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export function BatchesPage() {
  const { data: batches = [], isLoading } = useGetBatchesQuery()
  const { data: flags = [] } = useGetFlagsQuery({})
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')
  const [messageSeverity, setMessageSeverity] = useState<'success' | 'error'>('success')
  const [createOpen, setCreateOpen] = useState(false)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackReason, setRollbackReason] = useState('')
  const [createKey, setCreateKey] = useState('')
  const [createSource, setCreateSource] = useState<Environment | ''>('')
  const [createTargets, setCreateTargets] = useState<Environment[]>([])
  const [createName, setCreateName] = useState('')

  const [createBatch, createState] = useCreateBatchMutation()
  const [approveBatch, approveState] = useApproveBatchMutation()
  const [revalidateBatch, revalidateState] = useRevalidateBatchMutation()
  const [confirmCheck, confirmState] = useConfirmBatchCheckMutation()
  const [releaseBatch, releaseState] = useReleaseBatchMutation()
  const [rollbackBatch, rollbackState] = useRollbackBatchMutation()

  useEffect(() => {
    if (!selectedId && batches.length > 0) setSelectedId(batches[0].id)
  }, [batches, selectedId])

  const batch = batches.find((item) => item.id === selectedId)

  const flagKeys = useMemo(() => Array.from(new Set(flags.map((flag) => flag.key))), [flags])
  const sourceOptions = useMemo(
    () =>
      allEnvironments.filter((environment) =>
        flags.some((flag) => flag.key === createKey && flag.environment === environment),
      ),
    [flags, createKey],
  )

  const notify = (text: string, severity: 'success' | 'error' = 'success') => {
    setMessage(text)
    setMessageSeverity(severity)
  }

  const runMutation = async (action: PromiseLike<unknown>, success: string, fallback: string) => {
    try {
      await action
      notify(success)
    } catch (error) {
      notify(errorMessage(error, fallback), 'error')
    }
  }

  const openCreateDialog = () => {
    const firstKey = flagKeys[0] ?? ''
    setCreateKey(firstKey)
    const firstSource =
      allEnvironments.find((environment) =>
        flags.some((flag) => flag.key === firstKey && flag.environment === environment),
      ) ?? ''
    setCreateSource(firstSource)
    setCreateTargets([])
    setCreateName('')
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!createKey || !createSource || createTargets.length === 0) {
      notify('请选择开关 Key、来源环境和至少一个目标环境', 'error')
      return
    }
    try {
      const created = await createBatch({
        key: createKey,
        name: createName || `${createKey} 多环境批次`,
        sourceEnvironment: createSource,
        targetEnvironments: createTargets,
        actor: '林默',
      }).unwrap()
      setCreateOpen(false)
      setSelectedId(created.id)
      notify('批次已创建，来源环境、依赖、最低版本与灰度阶段已锁定')
    } catch (error) {
      notify(errorMessage(error, '创建批次失败'), 'error')
    }
  }

  const submitRollback = async () => {
    if (!batch || rollbackReason.trim().length < 8) {
      notify('回滚原因至少 8 个字符', 'error')
      return
    }
    try {
      await rollbackBatch({ id: batch.id, actor: '林默', reason: rollbackReason }).unwrap()
      setRollbackOpen(false)
      setRollbackReason('')
      notify('批次已回滚，发布前的受众、依赖与灰度阶段已恢复')
    } catch (error) {
      notify(errorMessage(error, '批次回滚失败'), 'error')
    }
  }

  const confirmedCount = batch?.checks.filter((check) => check.confirmed).length ?? 0
  const blockedCount = batch?.checks.filter((check) => check.blocked).length ?? 0

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">多环境发布批次</Typography>
          <Typography color="text.secondary">
            把同一 Key 的多环境发布收成批次：创建时锁定来源环境、依赖、最低版本与灰度阶段，批准前任何改动都会让候选失效。
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openCreateDialog}>
          新建批次
        </Button>
      </Box>

      {message && (
        <Alert severity={messageSeverity} onClose={() => setMessage('')} sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Box className="audit-summary">
        <Box>
          <Typography variant="caption">待处理候选</Typography>
          <Typography className="summary-value">
            {batches.filter((item) => item.status === 'pending').length}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption">已批准</Typography>
          <Typography className="summary-value">
            {batches.filter((item) => item.status === 'approved').length}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption">已发布</Typography>
          <Typography className="summary-value">
            {batches.filter((item) => item.status === 'released').length}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption">失效 / 被取代</Typography>
          <Typography className="summary-value">
            {batches.filter((item) => item.status === 'invalidated' || item.status === 'superseded').length}
          </Typography>
        </Box>
      </Box>

      <Box className="batch-layout">
        <Box className="batch-list">
          {batches.map((item) => (
            <Box
              key={item.id}
              className={`batch-list-item${item.id === selectedId ? ' selected' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="body2" fontWeight={700}>
                  {item.name}
                </Typography>
                <BatchStatusChip status={item.status} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {item.key} · {environmentLabels[item.sourceEnvironment]} →{' '}
                {item.targetEnvironments.map((env) => environmentLabels[env]).join('、')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                检查 {item.checks.filter((check) => check.confirmed).length}/{item.checks.length} 已确认
                {item.checks.some((check) => check.blocked) && ' · 存在阻断'} · 修订 v{item.revision}
              </Typography>
            </Box>
          ))}
          {!isLoading && batches.length === 0 && (
            <Box className="empty-state">暂无发布批次，点击右上角新建</Box>
          )}
        </Box>

        {batch && (
          <Box className="batch-detail">
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="h3">{batch.name}</Typography>
                      <BatchStatusChip status={batch.status} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {batch.key} · 修订 v{batch.revision} · 创建于{' '}
                      {batch.createdAt.slice(0, 16).replace('T', ' ')} · {batch.createdBy}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    {(batch.status === 'pending' || batch.status === 'approved') && (
                      <Button
                        variant="outlined"
                        startIcon={<RefreshOutlinedIcon />}
                        loading={revalidateState.isLoading}
                        onClick={() =>
                          void runMutation(
                            revalidateBatch({ id: batch.id }).unwrap(),
                            '已按当前配置重新校验检查项',
                            '重新校验失败',
                          )
                        }
                      >
                        重新校验
                      </Button>
                    )}
                    {batch.status === 'pending' && (
                      <Button
                        variant="contained"
                        startIcon={<CheckCircleOutlineIcon />}
                        loading={approveState.isLoading}
                        onClick={() =>
                          void runMutation(
                            approveBatch({
                              id: batch.id,
                              actor: '林默',
                              expectedRevision: batch.revision,
                            }).unwrap(),
                            '批次已批准，同 Key 其他候选批次已标记为被取代',
                            '批准批次失败',
                          )
                        }
                      >
                        批准批次
                      </Button>
                    )}
                    {batch.status === 'approved' && (
                      <Button
                        variant="contained"
                        color="success"
                        startIcon={<RocketLaunchOutlinedIcon />}
                        loading={releaseState.isLoading}
                        onClick={() =>
                          void runMutation(
                            releaseBatch({
                              id: batch.id,
                              actor: '林默',
                              expectedRevision: batch.revision,
                            }).unwrap(),
                            '批次已发布，目标环境已应用锁定快照',
                            '发布批次失败',
                          )
                        }
                      >
                        发布批次
                      </Button>
                    )}
                    {batch.status === 'released' && (
                      <Button
                        color="error"
                        variant="outlined"
                        startIcon={<UndoOutlinedIcon />}
                        onClick={() => setRollbackOpen(true)}
                      >
                        回滚批次
                      </Button>
                    )}
                  </Stack>
                </Stack>
                {batch.invalidatedReason && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {batch.invalidatedReason}
                  </Alert>
                )}
                {batch.rollbackReason && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    回滚原因：{batch.rollbackReason}（{batch.rolledBackAt?.slice(0, 16).replace('T', ' ')}）
                  </Alert>
                )}
                {blockedCount > 0 && (batch.status === 'pending' || batch.status === 'approved') && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    存在 {blockedCount} 个阻断项，整批停在待处理；解除阻断后点击「重新校验」，已确认项会保留。
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography variant="h3">发布检查</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {confirmedCount}/{batch.checks.length} 已确认
                  </Typography>
                </Stack>
                {batch.checks.map((check) => (
                  <Box key={check.id} className={`check-row${check.blocked ? ' blocked' : ''}`}>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" variant="outlined" label={checkKindLabel[check.kind]} />
                        <Typography variant="body2" fontWeight={700}>
                          {check.label}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {check.detail}
                      </Typography>
                    </Box>
                    {check.blocked ? (
                      <Chip size="small" color="error" label="阻断" />
                    ) : check.confirmed ? (
                      <Chip size="small" color="success" variant="outlined" label="已确认" />
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={
                          confirmState.isLoading ||
                          (batch.status !== 'pending' && batch.status !== 'approved')
                        }
                        onClick={() =>
                          void runMutation(
                            confirmCheck({ id: batch.id, checkId: check.id }).unwrap(),
                            '检查项已确认',
                            '确认检查项失败',
                          )
                        }
                      >
                        确认
                      </Button>
                    )}
                  </Box>
                ))}
              </CardContent>
            </Card>

            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 0.5 }}>
                  锁定快照
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  建批次时锁定的受众、依赖开关、最低客户端版本与灰度阶段，批准前任一环境改动都会使候选失效。
                </Typography>
                <SnapshotGrid entries={batch.snapshot} />
              </CardContent>
            </Card>

            {batch.preReleaseSnapshot && batch.preReleaseSnapshot.length > 0 && (
              <Card>
                <CardContent>
                  <Typography variant="h3" sx={{ mb: 0.5 }}>
                    发布前旧状态
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    发布时留存的旧配置，批次回滚会整体恢复该状态，历史快照与审计记录持续可查。
                  </Typography>
                  <SnapshotGrid entries={batch.preReleaseSnapshot} />
                </CardContent>
              </Card>
            )}
          </Box>
        )}
      </Box>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建多环境发布批次</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              select
              label="开关 Key"
              value={createKey}
              onChange={(event) => {
                const key = event.target.value
                setCreateKey(key)
                const firstSource =
                  allEnvironments.find((environment) =>
                    flags.some((flag) => flag.key === key && flag.environment === environment),
                  ) ?? ''
                setCreateSource(firstSource)
                setCreateTargets([])
              }}
            >
              {flagKeys.map((key) => (
                <MenuItem key={key} value={key}>
                  {key}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="来源环境（锁定快照）"
              value={createSource}
              onChange={(event) => {
                setCreateSource(event.target.value as Environment)
                setCreateTargets([])
              }}
            >
              {sourceOptions.map((environment) => (
                <MenuItem key={environment} value={environment}>
                  {environmentLabels[environment]}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                目标环境
              </Typography>
              {allEnvironments
                .filter((environment) => environment !== createSource)
                .map((environment) => (
                  <FormControlLabel
                    key={environment}
                    control={
                      <Checkbox
                        checked={createTargets.includes(environment)}
                        onChange={(event) =>
                          setCreateTargets((previous) =>
                            event.target.checked
                              ? [...previous, environment]
                              : previous.filter((item) => item !== environment),
                          )
                        }
                      />
                    }
                    label={environmentLabels[environment]}
                  />
                ))}
            </Box>
            <TextField
              label="批次名称"
              value={createName}
              placeholder={`${createKey} 多环境批次`}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" loading={createState.isLoading} onClick={() => void submitCreate()}>
            创建并锁定快照
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rollbackOpen} onClose={() => setRollbackOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>回滚批次「{batch?.name}」</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            回滚会把所有目标环境一起恢复到发布时留存的受众、依赖与灰度阶段，旧状态与审计记录仍可查询。
          </Alert>
          <TextField
            label="回滚原因"
            multiline
            minRows={3}
            fullWidth
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackOpen(false)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            loading={rollbackState.isLoading}
            onClick={() => void submitRollback()}
          >
            执行批次回滚
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
