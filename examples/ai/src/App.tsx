import { useChat } from '@ai-sdk/react'
import { silkweaveTransport } from '@silkweave/ai'
import { useEffect, useRef, useState } from 'react'
import { trpc } from './trpc.js'

const transport = silkweaveTransport(trpc.chat.subscribe)

export function App() {
  const { messages, sendMessage, status, stop, error } = useChat({ transport })
  const [input, setInput] = useState('')
  const conversationRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || status === 'streaming' || status === 'submitted') { return }
    sendMessage({ text })
    setInput('')
  }

  const isBusy = status === 'streaming' || status === 'submitted'

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto px-4">
      <header className="py-6 border-b border-neutral-800">
        <h1 className="text-xl font-semibold">Silkweave + Vercel AI SDK</h1>
        <p className="text-sm text-neutral-400 mt-1">
          <code className="text-xs bg-neutral-900 px-1.5 py-0.5 rounded">useChat</code> → custom transport → tRPC subscription → Silkweave streaming action → <code className="text-xs bg-neutral-900 px-1.5 py-0.5 rounded">streamText</code>
        </p>
      </header>

      <div ref={conversationRef} className="flex-1 overflow-y-auto py-6 space-y-4">
        {messages.length === 0 && (
          <p className="text-neutral-500 text-sm text-center mt-8">Send a message to start the conversation.</p>
        )}
        {messages.map((message) => (
          <Message key={message.id} role={message.role}>
            {messageText(message)}
          </Message>
        ))}
        {isBusy && status === 'submitted' && (
          <Message role="assistant">
            <span className="text-neutral-500">Thinking…</span>
          </Message>
        )}
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
            {error.message}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="py-4 border-t border-neutral-800 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSubmit(event)
            }
          }}
          placeholder="Say something…"
          rows={1}
          className="flex-1 resize-none bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-600 placeholder:text-neutral-600"
        />
        {isBusy ? (
          <button
            type="button"
            onClick={stop}
            className="bg-neutral-800 hover:bg-neutral-700 text-sm px-4 py-2 rounded-lg"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="bg-white text-black hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium px-4 py-2 rounded-lg"
          >
            Send
          </button>
        )}
      </form>
    </div>
  )
}

interface MessageProps {
  role: 'system' | 'user' | 'assistant'
  children: React.ReactNode
}

function Message({ role, children }: MessageProps) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${isUser
          ? 'bg-white text-black'
          : 'bg-neutral-900 text-neutral-100 border border-neutral-800'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

interface UIMessageLike {
  parts: Array<{ type: string; text?: string }>
}

function messageText(message: UIMessageLike): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}
