import React, { useMemo } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line
} from 'recharts'
import type { TrackerEntry } from '@shared/types'
import { STATUS_CONFIG, TRACKER_STATUSES } from '../../shared/utils/statusConfig'

interface Props {
  entries: TrackerEntry[]
}

const CHART_COLORS = ['#7c6af7', '#4caf82', '#f5a623', '#e05252', '#f5c842', '#64b5f6', '#ba68c8']

const TOOLTIP_STYLE = {
  backgroundColor: '#252525',
  border: '1px solid #3a3a3a',
  borderRadius: '8px',
  color: '#e8e8e8',
  fontSize: 12,
}

export default function AnalyticsDashboard({ entries }: Props) {
  const applied = entries.filter(e => e.appliedAt)

  // 1. Pipeline funnel data
  const funnelData = useMemo(() =>
    TRACKER_STATUSES.map(s => ({
      name: STATUS_CONFIG[s].label,
      value: entries.filter(e => e.status === s).length,
      fill: STATUS_CONFIG[s].color,
    })).filter(d => d.value > 0),
    [entries]
  )

  // 2. Response rate donut
  const responseData = useMemo(() => {
    const positive = entries.filter(e => ['positive_email', 'positive_interview', 'offer'].includes(e.status)).length
    const rejected = entries.filter(e => e.status === 'rejected').length
    const noResponse = entries.filter(e => e.status === 'no_response').length
    return [
      { name: 'Positive', value: positive, color: '#4caf82' },
      { name: 'Rejected', value: rejected, color: '#e05252' },
      { name: 'No Response', value: noResponse, color: '#6b6b6b' },
    ].filter(d => d.value > 0)
  }, [entries])

  // 3. Applications over time (by week)
  const timelineData = useMemo(() => {
    const byWeek: Record<string, number> = {}
    applied.forEach(e => {
      const d = new Date(e.appliedAt!)
      const week = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, '0')}`
      byWeek[week] = (byWeek[week] || 0) + 1
    })
    return Object.entries(byWeek).sort().map(([week, count], i, arr) => ({
      week,
      count,
      cumulative: arr.slice(0, i + 1).reduce((sum, [, c]) => sum + c, 0),
    }))
  }, [applied])

  // 4. By source
  const sourceData = useMemo(() => {
    const bySource: Record<string, { total: number; positive: number }> = {}
    entries.forEach(e => {
      const s = e.source || 'Unknown'
      if (!bySource[s]) bySource[s] = { total: 0, positive: 0 }
      bySource[s].total++
      if (['positive_email', 'positive_interview', 'offer'].includes(e.status)) bySource[s].positive++
    })
    return Object.entries(bySource).map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.total - a.total)
  }, [entries])

  // 5. Salary distribution
  const salaryData = useMemo(() => {
    const buckets: Record<string, number> = {}
    entries.forEach(e => {
      if (!e.salary) return
      const match = e.salary.match(/(\d+)/)
      if (!match) return
      const val = parseInt(match[1])
      const bucket = `$${Math.floor(val / 20) * 20}k–${Math.floor(val / 20) * 20 + 20}k`
      buckets[bucket] = (buckets[bucket] || 0) + 1
    })
    return Object.entries(buckets).sort().map(([range, count]) => ({ range, count }))
  }, [entries])

  // 6. Location map — group by state/city
  const locationData = useMemo(() => {
    const counts: Record<string, number> = {}
    entries.forEach(e => {
      if (e.location) counts[e.location] = (counts[e.location] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [entries])

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-text-dim">
        <p className="text-sm">No data yet. Track some applications first.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {/* Pipeline */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Pipeline</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnelData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis type="number" tick={{ fill: '#9e9e9e', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#9e9e9e', fontSize: 11 }} width={100} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                {funnelData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill || CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Response rate */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Response Rate</h3>
          {responseData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={responseData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {responseData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-text-dim text-center py-8">No response data yet</p>
          )}
        </div>

        {/* Timeline */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Applications Over Time</h3>
          {timelineData.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
                <XAxis dataKey="week" tick={{ fill: '#9e9e9e', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#9e9e9e', fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="cumulative" stroke="#7c6af7" strokeWidth={2} dot={false} name="Cumulative" />
                <Line type="monotone" dataKey="count" stroke="#4caf82" strokeWidth={2} dot={false} name="Per Week" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-text-dim text-center py-8">Need more data points</p>
          )}
        </div>

        {/* By source */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">By Source</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={sourceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="name" tick={{ fill: '#9e9e9e', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9e9e9e', fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="total" fill="#7c6af7" name="Total" radius={[4, 4, 0, 0]} />
              <Bar dataKey="positive" fill="#4caf82" name="Positive" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Salary distribution */}
      {salaryData.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Salary Distribution</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={salaryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis dataKey="range" tick={{ fill: '#9e9e9e', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9e9e9e', fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#f5c842" name="Roles" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Location bar chart */}
      {locationData.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Top Locations</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={locationData.map(([loc, count]) => ({ loc, count }))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3a" />
              <XAxis type="number" tick={{ fill: '#9e9e9e', fontSize: 11 }} />
              <YAxis type="category" dataKey="loc" tick={{ fill: '#9e9e9e', fontSize: 11 }} width={120} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#64b5f6" name="Applications" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
