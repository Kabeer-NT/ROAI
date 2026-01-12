import { useState } from 'react'
import { ChevronDown, ChevronRight, Code, Database, Search, CheckCircle } from 'lucide-react'
import type { ToolCall } from '../types'

interface ThinkingBlockProps {
  toolCalls: ToolCall[]
}

export function ThinkingBlock({ toolCalls }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!toolCalls || toolCalls.length === 0) return null

  const getIcon = (type: string) => {
    switch (type) {
      case 'formula': return <Code size={14} />
      case 'pandas': return <Database size={14} />
      case 'web_search': return <Search size={14} />
      default: return <Code size={14} />
    }
  }

  const formatResult = (result: any) => {
    if (typeof result === 'number') {
      return result.toLocaleString('en-US', { 
        minimumFractionDigits: 0,
        maximumFractionDigits: 2 
      })
    }
    if (typeof result === 'object') {
      return JSON.stringify(result, null, 2)
    }
    return String(result)
  }

  return (
    <div className="thinking-block">
      <button 
        className="thinking-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="thinking-title">
          🧠 Thinking ({toolCalls.length} operation{toolCalls.length !== 1 ? 's' : ''})
        </span>
        <CheckCircle size={14} className="thinking-done" />
      </button>
      
      {isExpanded && (
        <div className="thinking-content">
          {toolCalls.map((call, idx) => (
            <div key={idx} className="tool-call">
              <div className="tool-call-header">
                {getIcon(call.type)}
                <span className="tool-call-type">
                  {call.type === 'formula' ? 'Formula' : 
                   call.type === 'pandas' ? 'Python' : 'Web Search'}
                </span>
              </div>
              
              <div className="tool-call-body">
                {call.formula && (
                  <div className="tool-call-code">
                    <code>{call.formula}</code>
                    {call.sheet && <span className="tool-call-sheet">on {call.sheet}</span>}
                  </div>
                )}
                {call.code && (
                  <div className="tool-call-code">
                    <code>{call.code}</code>
                  </div>
                )}
                {call.query && (
                  <div className="tool-call-code">
                    <code>🔍 {call.query}</code>
                  </div>
                )}
                
                <div className="tool-call-result">
                  <span className="result-label">→</span>
                  <span className="result-value">{formatResult(call.result)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}