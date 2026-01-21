import { useState, useEffect } from 'react'
import { 
  X, 
  Palette, 
  User,
  Check,
  ChevronDown,
  LogOut,
  Moon,
  Sun
} from 'lucide-react'
import { useAuth } from '../hooks'

// ============================================================================
// Types
// ============================================================================

export interface SettingsData {
  theme: 'light' | 'dark'
  model: string
}

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  settings: SettingsData
  onSettingsChange: (settings: SettingsData) => void
  models: string[]
}

type TabId = 'general' | 'models' | 'account'

// ============================================================================
// Anthropic Logo Icon
// ============================================================================

function AnthropicLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 46 32" 
      fill="currentColor" 
      className={className}
    >
      <path d="M32.73 0h-6.945L38.45 32h6.945L32.73 0ZM13.27 0 0 32h7.082l2.59-6.72h13.25l2.59 6.72h7.082L19.328 0h-6.057Zm-.702 19.337 4.334-11.246 4.334 11.246h-8.668Z" />
    </svg>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

interface SelectProps {
  value: string
  options: { value: string; label: string; description?: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}

function Select({ value, options, onChange, disabled }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!isOpen) return
    const handleClick = () => setIsOpen(false)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [isOpen])

  return (
    <div className={`stg-select ${isOpen ? 'stg-select--open' : ''} ${disabled ? 'stg-select--disabled' : ''}`}>
      <button 
        className="stg-select-trigger"
        onClick={(e) => {
          e.stopPropagation()
          !disabled && setIsOpen(!isOpen)
        }}
        disabled={disabled}
      >
        <span>{selected?.label || value}</span>
        <ChevronDown size={14} className="stg-select-chevron" />
      </button>
      
      {isOpen && (
        <div className="stg-select-dropdown" onClick={e => e.stopPropagation()}>
          {options.map(opt => (
            <button
              key={opt.value}
              className={`stg-select-option ${opt.value === value ? 'stg-select-option--selected' : ''}`}
              onClick={() => {
                onChange(opt.value)
                setIsOpen(false)
              }}
            >
              <div className="stg-select-option-content">
                <span className="stg-select-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="stg-select-option-desc">{opt.description}</span>
                )}
              </div>
              {opt.value === value && <Check size={14} className="stg-select-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Tab Content Components
// ============================================================================

interface GeneralTabProps {
  settings: SettingsData
  onChange: (settings: SettingsData) => void
}

function GeneralTab({ settings, onChange }: GeneralTabProps) {
  return (
    <div className="stg-tab">
      <div className="stg-section">
        <div className="stg-section-header">
          <Palette size={18} />
          <div>
            <h3 className="stg-section-title">Appearance</h3>
            <p className="stg-section-desc">Customize how R-O-AI looks</p>
          </div>
        </div>
        
        <div className="stg-theme-picker">
          <button 
            className={`stg-theme-option ${settings.theme === 'dark' ? 'stg-theme-option--active' : ''}`}
            onClick={() => onChange({ ...settings, theme: 'dark' })}
          >
            <div className="stg-theme-preview stg-theme-preview--dark">
              <Moon size={20} />
            </div>
            <span className="stg-theme-label">Dark</span>
            {settings.theme === 'dark' && <Check size={14} className="stg-theme-check" />}
          </button>
          
          <button 
            className={`stg-theme-option ${settings.theme === 'light' ? 'stg-theme-option--active' : ''}`}
            onClick={() => onChange({ ...settings, theme: 'light' })}
          >
            <div className="stg-theme-preview stg-theme-preview--light">
              <Sun size={20} />
            </div>
            <span className="stg-theme-label">Light</span>
            {settings.theme === 'light' && <Check size={14} className="stg-theme-check" />}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ModelsTabProps {
  settings: SettingsData
  onChange: (settings: SettingsData) => void
  models: string[]
}

function ModelsTab({ settings, onChange, models }: ModelsTabProps) {
  const getModelInfo = (model: string) => {
    if (model.includes('opus')) return { 
      label: 'Claude Opus', 
      description: 'Most capable model for complex analysis and nuanced tasks',
      badge: 'Premium',
      color: 'purple'
    }
    if (model.includes('sonnet')) return { 
      label: 'Claude Sonnet', 
      description: 'Ideal balance of intelligence and speed for most tasks',
      badge: 'Recommended',
      color: 'amber'
    }
    if (model.includes('haiku')) return { 
      label: 'Claude Haiku', 
      description: 'Lightning fast responses for simple queries',
      badge: 'Fast',
      color: 'green'
    }
    return { label: model, description: '', badge: '', color: 'gray' }
  }

  return (
    <div className="stg-tab">
      <div className="stg-section">
        <div className="stg-section-header">
          <AnthropicLogo size={18} />
          <div>
            <h3 className="stg-section-title">AI Model</h3>
            <p className="stg-section-desc">Choose which model powers your conversations</p>
          </div>
        </div>

        <div className="stg-model-list">
          {models.map(model => {
            const info = getModelInfo(model)
            const isSelected = settings.model === model
            return (
              <button
                key={model}
                className={`stg-model-item ${isSelected ? 'stg-model-item--active' : ''}`}
                onClick={() => onChange({ ...settings, model })}
              >
                <div className={`stg-model-icon stg-model-icon--${info.color}`}>
                  <AnthropicLogo size={22} />
                </div>
                <div className="stg-model-content">
                  <div className="stg-model-header">
                    <span className="stg-model-name">{info.label}</span>
                    {info.badge && (
                      <span className={`stg-model-badge stg-model-badge--${info.color}`}>
                        {info.badge}
                      </span>
                    )}
                  </div>
                  <span className="stg-model-desc">{info.description}</span>
                </div>
                <div className="stg-model-select">
                  {isSelected ? (
                    <div className="stg-model-selected">
                      <Check size={16} />
                    </div>
                  ) : (
                    <div className="stg-model-unselected" />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AccountTab() {
  const { user, logout } = useAuth()

  return (
    <div className="stg-tab">
      <div className="stg-section">
        <div className="stg-account-card">
          <div className="stg-account-avatar">
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="stg-account-info">
            <div className="stg-account-name">{user?.full_name || 'User'}</div>
            <div className="stg-account-email">{user?.email || ''}</div>
          </div>
        </div>
      </div>

      <div className="stg-section">
        <div className="stg-section-header">
          <LogOut size={18} />
          <div>
            <h3 className="stg-section-title">Session</h3>
            <p className="stg-section-desc">Manage your current session</p>
          </div>
        </div>
        
        <button className="stg-btn stg-btn--danger" onClick={logout}>
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Main Settings Component
// ============================================================================

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Palette size={18} /> },
  { id: 'models', label: 'AI Model', icon: <AnthropicLogo size={18} /> },
  { id: 'account', label: 'Account', icon: <User size={18} /> },
]

export function Settings({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  models,
}: SettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general')

  useEffect(() => {
    if (!isOpen) return
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab settings={settings} onChange={onSettingsChange} />
      case 'models':
        return <ModelsTab settings={settings} onChange={onSettingsChange} models={models} />
      case 'account':
        return <AccountTab />
      default:
        return null
    }
  }

  return (
    <div className="stg-overlay" onClick={onClose}>
      <div className="stg-modal" onClick={e => e.stopPropagation()}>
        {/* Sidebar */}
        <div className="stg-sidebar">
          <div className="stg-sidebar-header">Settings</div>
          <nav className="stg-nav">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`stg-nav-item ${activeTab === tab.id ? 'stg-nav-item--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
          <div className="stg-sidebar-footer">
            <span className="stg-version">R-O-AI v1.0</span>
          </div>
        </div>

        {/* Content */}
        <div className="stg-content">
          <div className="stg-header">
            <h2 className="stg-title">{tabs.find(t => t.id === activeTab)?.label}</h2>
            <button className="stg-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <div className="stg-body">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  )
}

export function getDefaultSettings(): SettingsData {
  return {
    theme: 'dark',
    model: 'claude-sonnet-4-5-20250514',
  }
}