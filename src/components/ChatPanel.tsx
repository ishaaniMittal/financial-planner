'use client'

import { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VegaChart } from '@/components/VegaChart'
import { Send, RotateCcw, Bot, User, Loader2 } from 'lucide-react'
import Markdown from 'react-markdown'

const SUGGESTED_QUESTIONS = [
  "Am I on pace to max all my accounts this year?",
  "Where should my next dollar go?",
  "Show me my asset location across accounts",
  "How much tax drag am I paying?",
  "Show me my portfolio breakdown",
  "What does my monthly allocation trend look like?",
]

const WELCOME: UIMessage = {
  id: 'welcome',
  role: 'assistant',
  parts: [
    {
      type: 'text',
      text: "I'm your financial planning agent. I can analyze your cash flow, optimize asset location, and visualize your data. Try asking something below.",
    },
  ],
}

/** Concatenate all text parts of a message into a single string. */
function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function extractVisualizations(content: string): { clean: string; specs: Record<string, unknown>[] } {
  const specs: Record<string, unknown>[] = []
  const clean = content.replace(/```vega-lite\n([\s\S]*?)```/g, (_match, json) => {
    try { specs.push(JSON.parse(json.trim())) } catch { /* ignore */ }
    return '[Chart rendered below]'
  })
  return { clean, specs }
}

export const ChatPanel: React.FC = () => {
  const { messages, sendMessage, setMessages, status } = useChat({
    messages: [WELCOME],
  })
  const [input, setInput] = useState('')
  const isLoading = status === 'submitted' || status === 'streaming'

  const submit = (text: string) => {
    if (!text.trim() || isLoading) return
    sendMessage({ text: text.trim() })
    setInput('')
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit(input)
  }

  const resetChat = () => {
    setMessages([{ ...WELCOME, id: 'welcome-reset', parts: [{ type: 'text', text: 'Conversation reset. How can I help with your financial planning?' }] }])
  }

  const handlePinChart = async (spec: Record<string, unknown>) => {
    const title = (spec.title as string) || 'Saved Chart'
    const chartType = inferChartType(spec)
    try {
      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart_type: chartType, title, description: '' }),
      })
    } catch { /* silently fail */ }
  }

  const inferChartType = (spec: Record<string, unknown>): string => {
    const title = ((spec.title as string) || '').toLowerCase()
    const mark = spec.mark as Record<string, unknown> | string | undefined
    const markType = typeof mark === 'string' ? mark : mark?.type
    if (title.includes('allocation') || title.includes('balance')) return 'allocation_bar'
    if (title.includes('contribution') || title.includes('progress')) return 'contribution_progress'
    if (title.includes('trend') || title.includes('monthly')) return 'monthly_trend'
    if (title.includes('heatmap') || title.includes('location')) return 'asset_location_heatmap'
    if (title.includes('efficiency') || (markType === 'arc' && title.includes('tax'))) return 'tax_efficiency_donut'
    if (title.includes('drift')) return 'drift_bar'
    if (title.includes('holding') || title.includes('portfolio')) return 'holdings_pie'
    if (title.includes('waterfall') || title.includes('flow')) return 'cash_flow_waterfall'
    if (markType === 'arc') return 'tax_efficiency_donut'
    return 'allocation_bar'
  }

  return (
    <Card className="flex flex-col h-[700px]">
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Financial Advisor</CardTitle>
          <div className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
        </div>
        <button
          onClick={resetChat}
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Reset conversation"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col overflow-hidden p-0">
        <div className="flex-1 overflow-y-auto px-6 space-y-4 pt-2">
          {messages.map((msg) => {
            const text = messageText(msg)
            const { clean, specs } = msg.role === 'assistant'
              ? extractVisualizations(text)
              : { clean: text, specs: [] }

            return (
              <div key={msg.id} className="space-y-2">
                <div className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <span className="leading-relaxed">{clean}</span>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed
                        [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
                        [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1
                        [&_ul]:my-1 [&_ul]:pl-4 [&_li]:my-0.5
                        [&_p]:my-1 [&_strong]:font-semibold">
                        <Markdown>{clean}</Markdown>
                      </div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {specs.length > 0 && (
                  <div className="ml-10 space-y-2">
                    {specs.map((spec, idx) => (
                      <VegaChart
                        key={`${msg.id}-viz-${idx}`}
                        spec={spec}
                        showPin={true}
                        onPin={handlePinChart}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary-foreground" />
              </div>
              <div className="bg-secondary rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {messages.length <= 1 && (
          <div className="flex-shrink-0 px-6 py-3 border-t">
            <p className="text-xs text-muted-foreground mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  disabled={isLoading}
                  className="text-xs px-2.5 py-1 rounded-full border hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-shrink-0 border-t px-4 py-3">
          <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your finances..."
              disabled={isLoading}
              className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
