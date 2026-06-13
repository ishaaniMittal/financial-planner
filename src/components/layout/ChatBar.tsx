import { useState, useRef } from 'react'
import { CornerDownLeft } from 'lucide-react'

interface ChatBarProps {
  onSend?: (message: string) => void
  userName?: string
}

export function ChatBar({ onSend, userName = 'M' }: ChatBarProps) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend?.(trimmed)
    setValue('')
  }

  return (
    <div className="fixed bottom-0 left-0 z-50 px-6 pb-5 pt-3 bg-gradient-to-t from-background via-background/95 to-transparent" style={{ right: '320px' }}>
      <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-xl">
        {/* User avatar */}
        <div className="w-7 h-7 rounded-full bg-gold flex items-center justify-center text-xs font-semibold text-primary-foreground shrink-0">
          {userName.charAt(0).toUpperCase()}
        </div>

        {/* Input */}
        <textarea
          ref={ref}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Meridian to build a view, run a scenario, or change something…"
          rows={1}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none leading-relaxed min-h-[20px] max-h-32 overflow-y-auto scrollbar-thin"
        />

        {/* Send */}
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-gold hover:text-primary-foreground disabled:opacity-30 transition-colors"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">⌘K</span>
        </button>
      </div>
    </div>
  )
}
