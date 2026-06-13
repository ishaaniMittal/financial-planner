'use client'

import { useState } from 'react'
import { TopNav, type Domain } from '@/components/layout/TopNav'
import { FindingsSidebar } from '@/components/layout/FindingsSidebar'
import { ChatBar } from '@/components/layout/ChatBar'
import { Overview } from '@/components/overview/Overview'
import { DomainStub } from '@/components/layout/DomainStub'

export default function Home() {
  const [domain, setDomain] = useState<Domain>('overview')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav active={domain} onNavigate={setDomain} />
      {/* Fixed sidebar */}
      <div className="fixed top-14 right-0 w-80 bottom-0 z-30 overflow-y-auto scrollbar-thin border-l border-border">
        <FindingsSidebar />
      </div>

      {/* Scrollable main content */}
      <main className="pt-20 pb-28 px-8" style={{ marginRight: '320px' }}>
        {domain === 'overview'
          ? <Overview onNavigate={setDomain} userName="Maya" />
          : <DomainStub domain={domain} />
        }
      </main>
      <ChatBar userName="M" />
    </div>
  )
}
