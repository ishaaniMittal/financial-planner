import React, { useMemo } from 'react'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'

interface SankeyFlowProps {
  data: CashFlowData
}

export const SankeyFlow: React.FC<SankeyFlowProps> = ({ data }) => {
  const layout = useMemo(() => {
    const width = 900
    const height = 600
    const nodeWidth = 20
    const padding = 40
    const colPositions = [padding, width * 0.38, width * 0.72]

    // Source node (Cash Input)
    const sourceNode = {
      x: colPositions[0],
      y: height * 0.2,
      height: height * 0.6,
      label: 'Cash Input',
      value: data.totalInput,
      color: '#64748b',
    }

    // Category nodes
    const totalValue = data.categories.reduce(
      (sum, cat) => sum + cat.accounts.reduce((s, a) => s + a.value, 0),
      0
    )
    const availableHeight = height - padding * 2
    const categoryGap = 12

    let categoryY = padding
    const categoryNodes = data.categories.map((cat) => {
      const catValue = cat.accounts.reduce((s, a) => s + a.value, 0)
      const catHeight = Math.max(40, (catValue / totalValue) * (availableHeight - categoryGap * (data.categories.length - 1)))
      const node = {
        x: colPositions[1],
        y: categoryY,
        height: catHeight,
        label: cat.name,
        value: catValue,
        color: cat.color,
        id: cat.id,
      }
      categoryY += catHeight + categoryGap
      return node
    })

    // Account nodes
    const accountNodes: Array<{
      x: number
      y: number
      height: number
      label: string
      value: number
      color: string
      categoryId: string
    }> = []

    let accountY = padding
    data.categories.forEach((cat) => {
      const catValue = cat.accounts.reduce((s, a) => s + a.value, 0)
      const catHeight = Math.max(40, (catValue / totalValue) * (availableHeight - categoryGap * (data.categories.length - 1)))
      const accountGap = 6
      const accountAvailHeight = catHeight - accountGap * (cat.accounts.length - 1)

      let innerY = accountY
      cat.accounts.forEach((account) => {
        const accHeight = Math.max(16, (account.value / catValue) * accountAvailHeight)
        accountNodes.push({
          x: colPositions[2],
          y: innerY,
          height: accHeight,
          label: account.name,
          value: account.value,
          color: account.color,
          categoryId: cat.id,
        })
        innerY += accHeight + accountGap
      })
      accountY += catHeight + categoryGap
    })

    // Links from source to categories
    const sourceLinks = categoryNodes.map((catNode) => ({
      sourceX: sourceNode.x + nodeWidth,
      sourceY: sourceNode.y,
      sourceHeight: sourceNode.height,
      targetX: catNode.x,
      targetY: catNode.y,
      targetHeight: catNode.height,
      color: catNode.color,
      value: catNode.value,
      totalSourceValue: totalValue,
    }))

    // Links from categories to accounts
    const categoryLinks = accountNodes.map((accNode) => {
      const catNode = categoryNodes.find((c) => c.id === accNode.categoryId)!
      return {
        sourceX: catNode.x + nodeWidth,
        sourceY: catNode.y,
        sourceHeight: catNode.height,
        targetX: accNode.x,
        targetY: accNode.y,
        targetHeight: accNode.height,
        color: accNode.color,
        value: accNode.value,
        totalSourceValue: catNode.value,
      }
    })

    return { width, height, nodeWidth, sourceNode, categoryNodes, accountNodes, sourceLinks, categoryLinks }
  }, [data])

  const generateLinkPath = (
    link: {
      sourceX: number
      sourceY: number
      sourceHeight: number
      targetX: number
      targetY: number
      targetHeight: number
      value: number
      totalSourceValue: number
    },
    offsetRatio: number,
    links: typeof layout.sourceLinks,
    index: number
  ) => {
    // Calculate the vertical offset in the source for this link
    let sourceOffset = 0
    for (let i = 0; i < index; i++) {
      sourceOffset += (links[i].value / link.totalSourceValue) * link.sourceHeight
    }
    const bandHeight = (link.value / link.totalSourceValue) * link.sourceHeight

    const x0 = link.sourceX
    const y0 = link.sourceY + sourceOffset
    const x1 = link.targetX
    const y1 = link.targetY
    const curvature = 0.5
    const xi = x0 + (x1 - x0) * curvature

    // Top edge path
    const topPath = `M${x0},${y0} C${xi},${y0} ${xi},${y1} ${x1},${y1}`
    // Bottom edge path
    const bottomY0 = y0 + bandHeight
    const bottomY1 = y1 + link.targetHeight
    const bottomPath = `L${x1},${bottomY1} C${xi},${bottomY1} ${xi},${bottomY0} ${x0},${bottomY0} Z`

    return `${topPath} ${bottomPath}`

    void offsetRatio
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="w-full min-w-[700px]"
        style={{ maxHeight: '600px' }}
      >
        {/* Source to Category links */}
        {layout.sourceLinks.map((link, i) => (
          <path
            key={`s-link-${i}`}
            d={generateLinkPath(link, 0, layout.sourceLinks, i)}
            fill={link.color}
            fillOpacity={0.25}
            stroke={link.color}
            strokeOpacity={0.4}
            strokeWidth={0.5}
          />
        ))}

        {/* Category to Account links */}
        {layout.categoryLinks.map((link, i) => {
          // Group links by category to compute offset
          const catId = layout.accountNodes[i].categoryId
          const catLinks = layout.categoryLinks.filter(
            (_, idx) => layout.accountNodes[idx].categoryId === catId
          )
          const indexInCat = catLinks.indexOf(link)
          return (
            <path
              key={`c-link-${i}`}
              d={generateLinkPath(link, 0, catLinks, indexInCat)}
              fill={link.color}
              fillOpacity={0.25}
              stroke={link.color}
              strokeOpacity={0.4}
              strokeWidth={0.5}
            />
          )
        })}

        {/* Source node */}
        <rect
          x={layout.sourceNode.x}
          y={layout.sourceNode.y}
          width={layout.nodeWidth}
          height={layout.sourceNode.height}
          fill={layout.sourceNode.color}
          rx={4}
        />
        <text
          x={layout.sourceNode.x + layout.nodeWidth / 2}
          y={layout.sourceNode.y - 24}
          textAnchor="middle"
          className="text-sm font-semibold fill-foreground"
          fontSize={14}
        >
          {layout.sourceNode.label}
        </text>
        <text
          x={layout.sourceNode.x + layout.nodeWidth / 2}
          y={layout.sourceNode.y - 8}
          textAnchor="middle"
          className="text-xs fill-muted-foreground"
          fontSize={12}
        >
          {formatCurrency(layout.sourceNode.value)}
        </text>

        {/* Category nodes */}
        {layout.categoryNodes.map((node, i) => (
          <g key={`cat-${i}`}>
            <rect
              x={node.x}
              y={node.y}
              width={layout.nodeWidth}
              height={node.height}
              fill={node.color}
              rx={4}
            />
            <text
              x={node.x + layout.nodeWidth / 2}
              y={node.y - 14}
              textAnchor="middle"
              fontSize={12}
              className="font-medium"
              fill={node.color}
            >
              {node.label}
            </text>
            <text
              x={node.x + layout.nodeWidth / 2}
              y={node.y - 2}
              textAnchor="middle"
              fontSize={10}
              fill="#6b7280"
            >
              {formatCurrency(node.value)}
            </text>
          </g>
        ))}

        {/* Account nodes */}
        {layout.accountNodes.map((node, i) => (
          <g key={`acc-${i}`}>
            <rect
              x={node.x}
              y={node.y}
              width={layout.nodeWidth}
              height={node.height}
              fill={node.color}
              rx={3}
            />
            <text
              x={node.x + layout.nodeWidth + 8}
              y={node.y + node.height / 2 + 4}
              fontSize={11}
              className="fill-foreground"
            >
              {node.label}
            </text>
            <text
              x={node.x + layout.nodeWidth + 8}
              y={node.y + node.height / 2 + 16}
              fontSize={10}
              fill="#6b7280"
            >
              {formatCurrency(node.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
