export default function Slide4TechStack() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #050811 0%, #0a1020 100%)" }}>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #6366f1, transparent)" }} />

      <div className="absolute inset-0 flex flex-col" style={{ padding: "5.5vh 7vw" }}>
        <div style={{ marginBottom: "3.5vh" }}>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#6366f1", marginBottom: "1vh" }}>
            AI Layer
          </div>
          <div style={{ fontSize: "4vw", fontWeight: 900, lineHeight: 1.1, color: "#e8f0fe" }}>
            Four AI pillars. All powered by Claude.
          </div>
        </div>

        <div style={{ display: "flex", gap: "2vw", flex: 1 }}>

          {[
            {
              icon: "🗣",
              title: "Intent Parsing",
              subtitle: "Chain Abstraction",
              color: "#9945ff",
              what: 'User types: "swap half sol to btc cheapest"',
              how: "Claude parses natural language → structured intent params: fromChain, toChain, amount, route.",
              why: "User never needs to know chain IDs, token symbols, or gas tokens.",
              badge: "POST /api/intent/parse",
            },
            {
              icon: "📊",
              title: "Route Optimization",
              subtitle: "Best Path Analysis",
              color: "#14f195",
              what: "Given intent params + live solver bids, find optimal route",
              how: "Claude evaluates direct vs multi-hop (SOL→ETH→BTC), liquidity depth, estimated savings vs market.",
              why: "User always gets the analytically best route, not just the obvious one.",
              badge: "POST /api/intent/optimize",
            },
            {
              icon: "🤖",
              title: "AI Solver Agent",
              subtitle: "Autonomous Bidding",
              color: "#f59e0b",
              what: "4th solver in the marketplace — fully autonomous, no human operator",
              how: "Claude analyzes competitor bids, market conditions → computes optimal underbid (0.05–0.15%) in real-time.",
              why: "AI can participate as an economic agent, not just a tool. Same model as NEAR Intents.",
              badge: "Integrated in /intent/submit",
            },
            {
              icon: "⚖️",
              title: "Dispute Resolution",
              subtitle: "AI Judge",
              color: "#0ea5e9",
              what: "User claims delivery not received — files a dispute",
              how: "Claude evaluates: TX proof present? Hash valid? Status settled? Gives verdict: release / refund / investigate.",
              why: "Trustless dispute resolution without human arbiters. High-confidence verdicts auto-execute.",
              badge: "POST /api/intent/dispute",
            },
          ].map(item => (
            <div key={item.title} style={{
              flex: 1, background: "#0d1629", borderRadius: "1vw", padding: "2.5vh 2vw",
              display: "flex", flexDirection: "column", gap: "1.5vh",
              border: `1px solid ${item.color}25`,
              borderTop: `3px solid ${item.color}`,
            }}>
              <div style={{ fontSize: "2vw" }}>{item.icon}</div>
              <div>
                <div style={{ fontSize: "1.6vw", fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.title}</div>
                <div style={{ fontSize: "1.1vw", color: "#475569", marginTop: "0.3vh" }}>{item.subtitle}</div>
              </div>
              <div style={{ width: "3vw", height: "0.25vh", background: item.color, opacity: 0.4 }} />
              <div style={{ fontSize: "1.15vw", color: "#94a3b8", fontStyle: "italic" }}>&ldquo;{item.what}&rdquo;</div>
              <div style={{ fontSize: "1.15vw", color: "#64748b", lineHeight: 1.5, flex: 1 }}>{item.how}</div>
              <div style={{ fontSize: "1.05vw", color: item.color, lineHeight: 1.4 }}>{item.why}</div>
              <div style={{ background: `${item.color}12`, borderRadius: "0.4vw", padding: "0.6vh 1vw", border: `1px solid ${item.color}25` }}>
                <div style={{ fontSize: "0.95vw", color: item.color, fontFamily: "monospace" }}>{item.badge}</div>
              </div>
            </div>
          ))}

        </div>

        <div style={{ marginTop: "2vh", padding: "1.2vh 2vw", background: "rgba(99,102,241,0.06)", borderRadius: "0.6vw", border: "1px solid rgba(99,102,241,0.15)", textAlign: "center" }}>
          <div style={{ fontSize: "1.4vw", color: "#94a3b8" }}>
            All 4 AI features use <span style={{ color: "#6366f1", fontWeight: 700 }}>claude-sonnet-4-6</span> via Replit AI Integrations · Zero API key required · Billed per-token
          </div>
        </div>
      </div>
    </div>
  );
}
