import React, { useEffect, useRef, useState } from 'react'
import embed from 'vega-embed'
import { Pin, Check } from 'lucide-react'

interface VegaChartProps {
  spec: Record<string, unknown>
  showPin?: boolean
  onPin?: (spec: Record<string, unknown>) => void
}

export const VegaChart: React.FC<VegaChartProps> = ({ spec, showPin = false, onPin }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !spec) return

    const renderChart = async () => {
      try {
        await embed(containerRef.current!, spec as Parameters<typeof embed>[1], {
          actions: { export: true, source: false, compiled: false, editor: false },
          theme: 'latimes',
          renderer: 'svg',
        })
      } catch (err) {
        console.error('Vega embed error:', err)
      }
    }

    renderChart()

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [spec])

  const handlePin = () => {
    if (onPin && !pinned) {
      onPin(spec)
      setPinned(true)
    }
  }

  return (
    <div className="relative w-full my-2 rounded-lg border bg-card p-3 overflow-x-auto group">
      {showPin && onPin && (
        <button
          onClick={handlePin}
          disabled={pinned}
          className={`absolute top-2 right-2 z-10 p-1.5 rounded-md border text-xs flex items-center gap-1 transition-all ${
            pinned
              ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 opacity-0 group-hover:opacity-100'
          }`}
          title={pinned ? 'Saved to report' : 'Save to report dashboard'}
        >
          {pinned ? <Check className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          <span>{pinned ? 'Saved' : 'Pin'}</span>
        </button>
      )}
      <div ref={containerRef} />
    </div>
  )
}
