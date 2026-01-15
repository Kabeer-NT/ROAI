import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Copy, Check, User, Hexagon } from 'lucide-react'
import type { Message } from '../types'
import { ThinkingBlock } from './ThinkingBlock'
import { FollowupChips } from './FollowUpChips'

interface ChatMessageProps {
  message: Message
  onFollowupClick?: (text: string) => void
  isLatest?: boolean  // Only show followups on the latest assistant message
  disabled?: boolean
}

export function ChatMessage({ message, onFollowupClick, isLatest = false, disabled = false }: ChatMessageProps) {
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

  const showFollowups = 
    message.role === 'assistant' && 
    isLatest && 
    message.followups && 
    message.followups.length > 0 &&
    onFollowupClick

  return (
    <div className={`message ${message.role}`}>
      <div className="message-avatar">
        {message.role === 'user' ? <User size={18} /> : <Hexagon size={18} />}
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

        {/* Show followup chips for the latest assistant message */}
        {showFollowups && (
          <FollowupChips
            followups={message.followups!}
            onFollowupClick={onFollowupClick!}
            disabled={disabled}
            className="message-followups"
          />
        )}
      </div>
    </div>
  )
}

export function LoadingMessage() {
  return (
    <div className="message assistant">
      <div className="message-avatar">
        <Hexagon size={18} className="spinning" />
      </div>
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