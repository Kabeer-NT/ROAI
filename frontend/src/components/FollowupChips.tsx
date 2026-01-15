import { useState } from 'react'
import { MessageCircle, ChevronRight, Sparkles } from 'lucide-react'

export interface Followup {
  text: string
  type?: 'followup' | 'drill_down' | 'compare' | 'explore'
}

interface FollowupChipsProps {
  followups: Followup[] | string[]
  onFollowupClick: (text: string) => void
  disabled?: boolean
  className?: string
}

export function FollowupChips({ 
  followups, 
  onFollowupClick, 
  disabled = false,
  className = '' 
}: FollowupChipsProps) {
  const [clickedIdx, setClickedIdx] = useState<number | null>(null)

  // Normalize followups to always have text property
  const normalizedFollowups: Followup[] = followups.map(f => 
    typeof f === 'string' ? { text: f, type: 'followup' } : f
  )

  if (normalizedFollowups.length === 0) return null

  const handleClick = (followup: Followup, idx: number) => {
    if (disabled) return
    setClickedIdx(idx)
    onFollowupClick(followup.text)
    
    // Reset after animation
    setTimeout(() => setClickedIdx(null), 300)
  }

  return (
    <div className={`followup-chips ${className}`}>
      <div className="followup-header">
        <Sparkles size={12} className="followup-icon" />
        <span>Want to explore further?</span>
      </div>
      
      <div className="followup-list">
        {normalizedFollowups.map((followup, idx) => {
          const isClicked = clickedIdx === idx
          
          return (
            <button
              key={`${followup.text}-${idx}`}
              className={`followup-chip ${isClicked ? 'clicked' : ''}`}
              onClick={() => handleClick(followup, idx)}
              disabled={disabled}
            >
              <MessageCircle size={12} className="chip-icon" />
              <span className="chip-text">{followup.text}</span>
              <ChevronRight size={12} className="chip-arrow" />
            </button>
          )
        })}
      </div>
    </div>
  )
}