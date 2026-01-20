import { useState, useEffect } from 'react'
import { 
  X, 
  Settings as SettingsIcon, 
  Cpu, 
  User,
  Check,
  ChevronDown,
  LogOut
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
// Sub-components
// ============================================================================

interface SelectProps {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}

function Select({ value, options, onChange, disabled }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={`settings-select ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <button 
        className="select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span>{options.find(o => o.value === value)?.label || value}</span>
        <ChevronDown size={14} className={`select-chevron ${isOpen ? 'rotated' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="select-dropdown">
          {options.map(opt => (
            <button
              key={opt.value}
              className={`select-option ${opt.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value)
                setIsOpen(false)
              }}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-label">{label}</div>
        {description && <div className="setting-description">{description}</div>}
      </div>
      <div className="setting-control">
        {children}
      </div>
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
    <div className="settings-tab-content">
      <div className="settings-group">
        <h3 className="settings-group-title">Appearance</h3>
        <SettingRow 
          label="Theme" 
          description="Choose your color scheme"
        >
          <Select
            value={settings.theme}
            onChange={(v) => onChange({ ...settings, theme: v as 'light' | 'dark' })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </SettingRow>
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
  const modelOptions = models.map(m => ({
    value: m,
    label: m.includes('claude') ? m.split('-').slice(0, 3).map(s => 
      s.charAt(0).toUpperCase() + s.slice(1)
    ).join(' ') : m.toUpperCase()
  }))

  return (
    <div className="settings-tab-content">
      <div className="settings-group">
        <h3 className="settings-group-title">AI Model</h3>
        <SettingRow 
          label="Model" 
          description="Select the AI model for conversations"
        >
          <Select
            value={settings.model}
            onChange={(v) => onChange({ ...settings, model: v })}
            options={modelOptions}
          />
        </SettingRow>
      </div>
    </div>
  )
}

function AccountTab() {
  const { user, logout } = useAuth()

  return (
    <div className="settings-tab-content">
      <div className="settings-group">
        <div className="account-card">
          <div className="account-avatar">
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="account-info">
            <div className="account-name">{user?.full_name || 'User'}</div>
            <div className="account-email">{user?.email || ''}</div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Session</h3>
        <button className="settings-btn danger full-width" onClick={logout}>
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
  { id: 'general', label: 'General', icon: <SettingsIcon size={16} /> },
  { id: 'models', label: 'AI Model', icon: <Cpu size={16} /> },
  { id: 'account', label: 'Account', icon: <User size={16} /> },
]

export function Settings({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  models,
}: SettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general')

  // Close on Escape
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
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        {/* Sidebar */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">Settings</div>
          <nav className="settings-nav">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="settings-content">
          <div className="settings-header">
            <h2 className="settings-title">
              {tabs.find(t => t.id === activeTab)?.label}
            </h2>
            <button className="settings-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="settings-body">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  )
}

// Default settings factory
export function getDefaultSettings(): SettingsData {
  return {
    theme: 'dark',
    model: 'claude-sonnet-4-5-20250514',
  }
}