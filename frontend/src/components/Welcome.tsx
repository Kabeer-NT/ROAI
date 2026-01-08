interface WelcomeProps {
  onHintClick: (hint: string) => void
}

const hints = [
  "What's my highest revenue month?",
  "Calculate average contract value",
  "Which products are most profitable?",
  "Show me a summary of all sheets",
]

export function Welcome({ onHintClick }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-icon">◈</div>
      <h1>R-O-AI</h1>
      <p>Upload spreadsheets and ask questions about your data</p>
      <div className="welcome-hints">
        {hints.map(hint => (
          <button
            key={hint}
            className="hint"
            onClick={() => onHintClick(hint)}
          >
            {hint}
          </button>
        ))}
      </div>
    </div>
  )
}
