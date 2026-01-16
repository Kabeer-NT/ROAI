import { useState } from 'react'
import { ExternalLink, Globe, ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import type { WebSource } from '../types'

interface SourcesListProps {
  sources: WebSource[]
  className?: string
  defaultExpanded?: boolean
}

/**
 * Displays a collapsible list of web source citations from search results.
 * Clean, spacious design with favicons and external links.
 */
export function SourcesList({ 
  sources, 
  className = '',
  defaultExpanded = false
}: SourcesListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (!sources || sources.length === 0) return null

  // Extract domain from URL for display
  const getDomain = (url: string): string => {
    try {
      const hostname = new URL(url).hostname
      return hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  // Get favicon URL
  const getFaviconUrl = (url: string): string => {
    try {
      const domain = new URL(url).origin
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    } catch {
      return ''
    }
  }

  return (
    <div className={`sources-list ${className}`}>
      {/* Collapsible Header - like thinking block */}
      <button 
        className="sources-header-btn"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Link2 size={14} className="sources-icon" />
        <span className="sources-title">Sources</span>
        <span className="sources-count">{sources.length}</span>
      </button>

      {/* Expandable Content - shows all sources when open */}
      {isExpanded && (
        <div className="sources-content">
          <div className="sources-items">
            {sources.map((source, idx) => (
              <a
                key={`${source.url}-${idx}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="source-item"
              >
                <div className="source-favicon">
                  <img 
                    src={getFaviconUrl(source.url)} 
                    alt=""
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      e.currentTarget.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                  <Globe size={14} className="source-favicon-fallback hidden" />
                </div>
                
                <div className="source-content">
                  <div className="source-title-row">
                    <span className="source-title">
                      {source.title || getDomain(source.url)}
                    </span>
                    <ExternalLink size={12} className="source-external-icon" />
                  </div>
                  <span className="source-domain">{getDomain(source.url)}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Compact inline source badges for use within text
 */
interface SourceBadgesProps {
  sources: WebSource[]
  maxVisible?: number
}

export function SourceBadges({ sources, maxVisible = 5 }: SourceBadgesProps) {
  if (!sources || sources.length === 0) return null

  const visibleSources = sources.slice(0, maxVisible)
  const remaining = sources.length - maxVisible

  const getDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  return (
    <div className="source-badges">
      {visibleSources.map((source, idx) => (
        <a
          key={`${source.url}-${idx}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="source-badge"
          title={source.title || source.url}
        >
          <Globe size={10} />
          <span>{getDomain(source.url)}</span>
        </a>
      ))}
      {remaining > 0 && (
        <span className="source-badge more">+{remaining}</span>
      )}
    </div>
  )
}