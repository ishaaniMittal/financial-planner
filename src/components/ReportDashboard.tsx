import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { VegaChart } from '@/components/VegaChart'
import { Trash2, RefreshCw, LayoutDashboard } from 'lucide-react'

interface ReportItem {
  id: string
  chart_type: string
  title: string
  description: string
  created_at: string
  position: number
}

const API_BASE = 'http://localhost:8000'

export const ReportDashboard: React.FC = () => {
  const [items, setItems] = useState<ReportItem[]>([])
  const [specs, setSpecs] = useState<Record<string, Record<string, unknown>>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reports`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.sort((a: ReportItem, b: ReportItem) => a.position - b.position))
      }
    } catch {
      // API not available
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSpecs = useCallback(async (reportItems: ReportItem[]) => {
    // For each saved chart_type, ask the API to generate a fresh spec
    // We'll use a dedicated endpoint that generates specs on demand
    const newSpecs: Record<string, Record<string, unknown>> = {}
    for (const item of reportItems) {
      try {
        const res = await fetch(`${API_BASE}/api/reports/${item.id}/render`)
        if (res.ok) {
          const spec = await res.json()
          newSpecs[item.id] = spec
        }
      } catch {
        // Skip failed renders
      }
    }
    setSpecs(newSpecs)
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  useEffect(() => {
    if (items.length > 0) {
      fetchSpecs(items)
    }
  }, [items, fetchSpecs])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchReports()
    if (items.length > 0) {
      await fetchSpecs(items)
    }
    setRefreshing(false)
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/reports/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id))
        setSpecs((prev) => {
          const updated = { ...prev }
          delete updated[id]
          return updated
        })
      }
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <LayoutDashboard className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No saved reports yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Ask the agent to create visualizations, then pin them here for your monthly review.
            You can also ask: "Build me a monthly review report."
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Report header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Monthly Review Report</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} saved visualization{items.length !== 1 ? 's' : ''} — auto-refreshed with latest data
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh All
        </button>
      </div>

      {/* Chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  {item.description && (
                    <CardDescription className="mt-1">{item.description}</CardDescription>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove from report"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {specs[item.id] ? (
                <VegaChart spec={specs[item.id]} />
              ) : (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Loading chart...
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
