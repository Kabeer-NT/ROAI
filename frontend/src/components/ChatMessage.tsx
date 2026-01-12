import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Copy, Check } from 'lucide-react'
import type { Message } from '../types'
import { ThinkingBlock } from './ThinkingBlock'

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className={`message ${message.role}`}>
      <div className="message-avatar">
        {message.role === 'user' ? '◉' : '◈'}
      </div>
      <div className="message-body">
        <div className="message-header">
          <span className="message-sender">
            {message.role === 'user' ? 'You' : 'R-O-AI'}
          </span>
          <span className="message-time">{formatTime(message.timestamp)}</span>
          {message.role === 'assistant' && (
            <button 
              className={`copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
              title={copied ? 'Copied!' : 'Copy response'}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
        
        {/* Show thinking block for assistant messages with tool calls */}
        {message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0 && (
          <ThinkingBlock toolCalls={message.toolCalls} />
        )}
        
        <div className="message-content">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <a 
                  href={href} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="source-link"
                >
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export function LoadingMessage() {
  return (
    <div className="message assistant">
      <div className="message-avatar">◈</div>
      <div className="message-body">
        <div className="message-header">
          <span className="message-sender">R-O-AI</span>
        </div>
        <div className="message-content loading">
          <span className="loading-dot" />
          <span className="loading-dot" />
          <span className="loading-dot" />
        </div>
      </div>
    </div>
  )
}