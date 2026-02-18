import type { JobStatus } from '@shared/types'

export const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; badgeClass: string }> = {
  needs_enrichment: { label: 'Needs Enrichment', color: '#6b6b6b', badgeClass: 'badge-gray' },
  enrichment_failed: { label: 'Enrichment Failed', color: '#e05252', badgeClass: 'badge-red' },
  no_response: { label: 'No Response', color: '#9e9e9e', badgeClass: 'badge-gray' },
  positive_email: { label: 'Positive — Email', color: '#4caf82', badgeClass: 'badge-green' },
  positive_interview: { label: 'Positive — Interview', color: '#00e676', badgeClass: 'badge-green' },
  offer: { label: 'Offer', color: '#f5c842', badgeClass: 'badge-gold' },
  rejected: { label: 'Rejected', color: '#e05252', badgeClass: 'badge-red' },
  withdrawn: { label: 'Withdrawn', color: '#f5a623', badgeClass: 'badge-orange' },
}

export const TRACKER_STATUSES: JobStatus[] = [
  'no_response',
  'positive_email',
  'positive_interview',
  'offer',
  'rejected',
  'withdrawn',
]
