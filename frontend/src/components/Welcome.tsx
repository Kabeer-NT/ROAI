import { useState, useEffect } from 'react'
import { Hexagon, TrendingUp, Calculator, PieChart, LayoutList, Sparkles, Loader2, Upload } from 'lucide-react'
import { useAuth } from '../hooks'

interface WelcomeProps {
  onHintClick: (hint: string) => void
  hasFiles?: boolean
  showSuggestions?: boolean  // NEW: Control when suggestions appear
}

// Icon rotation for dynamic suggestions
const dynamicIcons = [TrendingUp, Calculator, PieChart, LayoutList]

export function Welcome({ onHintClick, hasFiles = false, showSuggestions = false }: WelcomeProps) {
  const { token } = useAuth()
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)

  // Fetch suggestions when files are available AND showSuggestions is true
  useEffect(() => {
    if (hasFiles && showSuggestions && token && !hasFetched) {
      fetchSuggestions()
    }
  }, [hasFiles, showSuggestions, token, hasFetched])

  // Reset when files change
  useEffect(() => {
    if (!hasFiles) {
      setSuggestions([])
      setHasFetched(false)
    }
  }, [hasFiles])

  const fetchSuggestions = async () => {
    if (!token) return
    
    setIsLoading(true)
    try {
      const res = await fetch('/api/spreadsheet/suggestions', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.ok) {
        const data = await res.json()
        if (data.suggestions && data.suggestions.length > 0) {
          setSuggestions(data.suggestions)
        }
      }
    } catch (err) {
      console.error('Failed to fetch suggestions:', err)
    } finally {
      setIsLoading(false)
      setHasFetched(true)
    }
  }

  const refreshSuggestions = () => {
    setHasFetched(false)
    setSuggestions([])
    setTimeout(fetchSuggestions, 100)
  }

  // Build display hints from suggestions
  const displayHints = suggestions.map((text, i) => ({ 
    text, 
    icon: dynamicIcons[i % dynamicIcons.length] 
  }))

  return (
    <div className="welcome">
      <Hexagon className="welcome-icon" size={48} />
      <h1>R-O-AI</h1>
      
      {!hasFiles ? (
        // No files uploaded - show upload prompt
        <>
          <p className="welcome-subtitle">
            Your AI-powered spreadsheet assistant
          </p>
          <div className="welcome-upload-prompt">
            <Upload size={20} />
            <span>Upload a spreadsheet to get started</span>
          </div>
          <p className="welcome-formats">
            Supports .xlsx, .xls, .csv, .tsv
          </p>
        </>
      ) : showSuggestions ? (
        // Files uploaded AND suggestions should show
        <>
          <p className="welcome-subtitle">
            Ask questions about your data
          </p>
          
          <div className="welcome-hints">
            {isLoading ? (
              <div className="hints-loading">
                <Loader2 size={20} className="spinning" />
                <span>Analyzing your data...</span>
              </div>
            ) : suggestions.length > 0 ? (
              <>
                <div className="hints-header">
                  <Sparkles size={14} />
                  <span>Suggested questions for your data</span>
                </div>
                {displayHints.map((hint, idx) => (
                  <button
                    key={`${hint.text}-${idx}`}
                    className="hint dynamic"
                    onClick={() => onHintClick(hint.text)}
                  >
                    <hint.icon size={16} />
                    {hint.text}
                  </button>
                ))}
              </>
            ) : (
              // No suggestions loaded yet but should show
              <div className="hints-loading">
                <Loader2 size={20} className="spinning" />
                <span>Loading suggestions...</span>
              </div>
            )}
          </div>
          
          {suggestions.length > 0 && (
            <button 
              className="refresh-suggestions"
              onClick={refreshSuggestions}
              title="Get new suggestions"
            >
              <Sparkles size={12} />
              Refresh suggestions
            </button>
          )}
        </>
      ) : (
        // Files uploaded but suggestions not triggered yet (shouldn't normally happen)
        <p className="welcome-subtitle">
          Ask questions about your data
        </p>
      )}
    </div>
  )
}