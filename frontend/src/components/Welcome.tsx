import { Hexagon, TrendingUp, Calculator, PieChart, LayoutList } from 'lucide-react'

interface WelcomeProps {
  onHintClick: (hint: string) => void
}

const hints = [
  { text: "What's my highest revenue month?", icon: TrendingUp },
  { text: "Calculate average contract value", icon: Calculator },
  { text: "Which products are most profitable?", icon: PieChart },
  { text: "Show me a summary of all sheets", icon: LayoutList },
]

export function Welcome({ onHintClick }: WelcomeProps) {
  return (
    <div className="welcome">
      <Hexagon className="welcome-icon" size={48} />
      <h1>R-O-AI</h1>
      <p>Upload spreadsheets and ask questions about your data</p>
      <div className="welcome-hints">
        {hints.map(hint => (
          <button
            key={hint.text}
            className="hint"
            onClick={() => onHintClick(hint.text)}
          >
            <hint.icon size={16} />
            {hint.text}
          </button>
        ))}
      </div>
    </div>
  )
}