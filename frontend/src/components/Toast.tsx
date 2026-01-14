import { useState, useEffect } from 'react'
import { CheckCircle, X, FileSpreadsheet } from 'lucide-react'

export interface ToastData {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  duration?: number
}

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const duration = toast.duration ?? 3000
    const exitTimer = setTimeout(() => setIsExiting(true), duration - 300)
    const dismissTimer = setTimeout(() => onDismiss(toast.id), duration)
    
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(dismissTimer)
    }
  }, [toast, onDismiss])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => onDismiss(toast.id), 300)
  }

  return (
    <div className={`toast toast-${toast.type} ${isExiting ? 'toast-exit' : ''}`}>
      <div className="toast-icon">
        {toast.type === 'success' && <CheckCircle size={18} />}
        {toast.type === 'error' && <X size={18} />}
        {toast.type === 'info' && <FileSpreadsheet size={18} />}
      </div>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={handleDismiss}>
        <X size={14} />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = (message: string, type: ToastData['type'] = 'info', duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(prev => [...prev, { id, message, type, duration }])
    return id
  }

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const clearAll = () => setToasts([])

  return { toasts, addToast, dismissToast, clearAll }
}