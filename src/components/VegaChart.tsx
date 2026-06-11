import React, { useEffect, useRef } from 'react'
import embed from 'vega-embed'

interface VegaChartProps {
  spec: Record<string, unknown>
}

export const VegaChart: React.FC<VegaChartProps> = ({ spec }) => {
  const containerRef = useRef<HTMLDivElement>(null)

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

  return (
    <div
      ref={containerRef}
      className="w-full my-2 rounded-lg border bg-card p-3 overflow-x-auto"
    />
  )
}
