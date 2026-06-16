import type { ReactNode } from 'react'

export const metadata = {
  title: 'Silkweave Next.js example',
  description: 'One action set exposed as MCP tools + a tRPC endpoint'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
        {children}
      </body>
    </html>
  )
}
