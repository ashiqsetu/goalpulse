export default function ErrorBox({ message, children }) {
  if (!message) return null
  return (
    <div className="card border-gold/40 bg-gold/10 p-4 text-sm text-gold">
      <div className="font-semibold">Heads up</div>
      <div className="mt-1">{message}</div>
      {children}
    </div>
  )
}
