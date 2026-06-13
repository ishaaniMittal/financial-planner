import { useState } from 'react'
import { TopNav, type Domain } from '@/components/layout/TopNav'
import { FindingsSidebar } from '@/components/layout/FindingsSidebar'
import { ChatBar } from '@/components/layout/ChatBar'
import { Overview } from '@/components/overview/Overview'
import { DomainStub } from '@/components/layout/DomainStub'

function App() {
  const [domain, setDomain] = useState<Domain>('overview')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav active={domain} onNavigate={setDomain} />

      {/* Page body: below fixed nav, above fixed chat bar */}
      <div className="flex pt-14 pb-24">
        {/* Main content */}
        <main className="flex-1 min-w-0 px-8 py-8 pr-6">
          {domain === 'overview'
            ? <Overview onNavigate={setDomain} userName="Maya" />
            : <DomainStub domain={domain} />
          }
        </main>

        {/* Right sidebar */}
        <FindingsSidebar />
      </div>

      {/* Pinned chat bar */}
      <ChatBar userName="M" />
    </div>
  )
}

export default App
