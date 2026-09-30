import { Chip } from '@mui/material'
import type { BatchStatus } from '@/types'

const statusMap: Record<BatchStatus, { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }> = {
  collecting: { label: '待批准', color: 'info' },
  ready: { label: '待发布', color: 'success' },
  blocked: { label: '待处理', color: 'warning' },
  published: { label: '已发布', color: 'success' },
  'rolled-back': { label: '已整批回滚', color: 'error' },
  invalidated: { label: '已失效', color: 'error' },
  superseded: { label: '已被取代', color: 'default' },
}

export function BatchStatusChip({ status }: { status: BatchStatus }) {
  const value = statusMap[status]
  return (
    <Chip
      label={value.label}
      color={value.color}
      size="small"
      variant={status === 'published' ? 'filled' : 'outlined'}
    />
  )
}
