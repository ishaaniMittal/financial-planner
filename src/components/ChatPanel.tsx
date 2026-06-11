import React, { useState, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VegaChart } from '@/components/VegaChart'
import { Send, RotateCcw, Bot, User, Loader2 } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: Date
  visualizations?: Record<string, unknown>[]
}

const SUGGESTED_QUESTIONS = [
  "Am I on pace to max all my accounts this year?",
  "Where should my next dollar go?",
  "Show me my asset location across accounts",
  "How much tax drag am I paying?",
  "Show me my portfolio breakdown",
  "What does my monthly allocation trend look like?",
]

export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: "I'm your financial planning agent. I can analyze your cash flow, optimize asset location, and visualize your data with the best chart for each question. Try asking something below.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('http://localhost:8000/api/health')
      .then((res) => res.json())
      .then(() => setIsConnected(true))
      .catch(() => setIsConnected(false))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }

      const data = await res.json()

      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: data.response,
        timestamp: new Date(),
        visualizations: data.visualizations?.length > 0 ? data.visualizations : undefined,
      }

      setMessages((prev) => [...prev, agentMessage])
      setIsConnected(true)
    } catch {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `Unable to reach the agent API. Make sure the server is running:\n\n\`uvicorn agent.server:app --reload --port 8000\``,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
      setIsConnected(false)
    } finally {
      setIsLoading(false)
    }
  }

  const resetChat = async () => {
    try {
      await fetch('http://localhost:8000/api/chat/reset', { method: 'POST' })
    } catch {
      // Agent might be down, reset UI anyway
    }
    setMessages([
      {
        id: 'welcome-reset',
        role: 'agent',
        content: "Conversation reset. How can I help with your financial planning?",
        timestamp: new Date(),
      },
    ])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <Card className="flex flex-col h-[700px]">
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Financial Advisor</CardTitle>
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected === true ? 'bg-emerald-500' : isConnected === false ? 'bg-red-500' : 'bg-amber-500'
            }`}
            title={isConnected === true ? 'Connected' : isConnected === false ? 'Disconnected' : 'Checking...'}
          />
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
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-2">
              <div className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'agent' && (
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
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {msg.content}
                  </pre>
                </div>
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Render visualizations inline below the message */}
              {msg.visualizations && msg.visualizations.length > 0 && (
                <div className="ml-10 space-y-2">
                  {msg.visualizations.map((spec, idx) => (
                    <VegaChart key={`${msg.id}-viz-${idx}`} spec={spec} />
                  ))}
                </div>
              )}
            </div>
          ))}

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

          <div ref={messagesEndRef} />
        </div>

        {/* Suggested questions (only show when few messages) */}
        {messages.length <= 1 && (
          <div className="flex-shrink-0 px-6 py-3 border-t">
            <p className="text-xs text-muted-foreground mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={isLoading}
                  className="text-xs px-2.5 py-1 rounded-full border hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex-shrink-0 border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your finances..."
              disabled={isLoading}
              className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
