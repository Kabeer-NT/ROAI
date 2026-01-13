import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Cpu } from 'lucide-react'

interface ModelSelectorProps {
  models: string[]
  selectedModel: string
  onModelChange: (model: string) => void
  disabled?: boolean
}

// Anthropic icon from Simple Icons (https://simpleicons.org)
const AnthropicIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor"
    className={className}
    role="img"
  >
    <path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/>
  </svg>
)

// OpenAI icon from Simple Icons (https://simpleicons.org)
const OpenAIIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor"
    className={className}
    role="img"
  >
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
  </svg>
)

// Model metadata for nice display
interface ModelMeta {
  label: string
  description: string
  icon: React.FC<{ size?: number; className?: string }>
  provider: 'anthropic' | 'openai' | 'other'
}

const modelInfo: Record<string, ModelMeta> = {
  // Anthropic models
  'claude-sonnet-4-5-20250514': {
    label: 'Claude Sonnet 4.5',
    description: 'Fast & capable',
    icon: AnthropicIcon,
    provider: 'anthropic',
  },
  'claude-3-5-sonnet-20241022': {
    label: 'Claude 3.5 Sonnet',
    description: 'Balanced performance',
    icon: AnthropicIcon,
    provider: 'anthropic',
  },
  'claude-opus-4-20250514': {
    label: 'Claude Opus 4',
    description: 'Most capable',
    icon: AnthropicIcon,
    provider: 'anthropic',
  },
  'claude-3-opus-20240229': {
    label: 'Claude 3 Opus',
    description: 'High capability',
    icon: AnthropicIcon,
    provider: 'anthropic',
  },
  'claude-3-5-haiku-20241022': {
    label: 'Claude 3.5 Haiku',
    description: 'Fast & efficient',
    icon: AnthropicIcon,
    provider: 'anthropic',
  },
  // OpenAI models
  'gpt-4o': {
    label: 'GPT-4o',
    description: 'OpenAI flagship',
    icon: OpenAIIcon,
    provider: 'openai',
  },
  'gpt-4o-mini': {
    label: 'GPT-4o Mini',
    description: 'Fast & efficient',
    icon: OpenAIIcon,
    provider: 'openai',
  },
  'gpt-4-turbo': {
    label: 'GPT-4 Turbo',
    description: 'High capability',
    icon: OpenAIIcon,
    provider: 'openai',
  },
  'gpt-3.5-turbo': {
    label: 'GPT-3.5 Turbo',
    description: 'Fast & affordable',
    icon: OpenAIIcon,
    provider: 'openai',
  },
}

function getModelInfo(modelId: string): ModelMeta {
  if (modelInfo[modelId]) {
    return modelInfo[modelId]
  }
  
  // Auto-detect provider from model ID
  const lowerModel = modelId.toLowerCase()
  if (lowerModel.includes('claude')) {
    return {
      label: modelId.split('-').slice(0, 3).map(s => 
        s.charAt(0).toUpperCase() + s.slice(1)
      ).join(' '),
      description: 'Anthropic model',
      icon: AnthropicIcon,
      provider: 'anthropic',
    }
  }
  if (lowerModel.includes('gpt')) {
    return {
      label: modelId.toUpperCase(),
      description: 'OpenAI model',
      icon: OpenAIIcon,
      provider: 'openai',
    }
  }
  
  // Fallback for unknown models
  return {
    label: modelId,
    description: 'AI Model',
    icon: ({ size, className }) => <Cpu size={size} className={className} />,
    provider: 'other',
  }
}

export function ModelSelector({ models, selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const selectedInfo = getModelInfo(selectedModel)
  const SelectedIcon = selectedInfo.icon

  if (models.length === 0) {
    return (
      <div className="model-selector disabled">
        <div className="model-selector-trigger">
          <Cpu size={16} className="model-icon" />
          <span className="model-label">No models available</span>
        </div>
      </div>
    )
  }

  return (
    <div 
      className={`model-selector ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      ref={containerRef}
    >
      <button
        className="model-selector-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <SelectedIcon size={16} className="model-icon" />
        <div className="model-trigger-content">
          <span className="model-label">{selectedInfo.label}</span>
          <span className="model-description">{selectedInfo.description}</span>
        </div>
        <ChevronDown size={16} className={`chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          {models.map(model => {
            const info = getModelInfo(model)
            const Icon = info.icon
            const isSelected = model === selectedModel

            return (
              <button
                key={model}
                className={`model-option ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onModelChange(model)
                  setIsOpen(false)
                }}
              >
                <Icon size={16} className="model-option-icon" />
                <div className="model-option-content">
                  <span className="model-option-label">{info.label}</span>
                  <span className="model-option-description">{info.description}</span>
                </div>
                {isSelected && <Check size={16} className="model-check" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}