import { Chip } from '@mui/material'
import type { BatchStatus } from '@/types'

const statusMap: Record<
  BatchStatus,
  { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }
> = {
  pending: { label: '待处理', color: 'warning' },
  approved: { label: '已批准', color: 'info' },
  released: { label: '已发布', color: 'success' },
  invalidated: { label: '已失效', color: 'error' },
  superseded: { label: '被取代', color: 'default' },
  'rolled-back': { label: '已回滚', color: 'error' },
}

export function BatchStatusChip({ status }: { status: BatchStatus }) {
  const value = statusMap[status]
  return (
    <Chip
      label={value.label}
      color={value.color}
      size="small"
      variant={status === 'released' ? 'filled' : 'outlined'}
    />
  )
}
