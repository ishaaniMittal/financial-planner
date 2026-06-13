import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Meridian',
  description: 'Your personal financial planning agent',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
