export default function Slide6DemoFlow() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "linear-gradient(160deg, #050811 0%, #0a1020 100%)" }}>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #f59e0b, transparent)" }} />

      <div className="absolute inset-0 flex flex-col" style={{ padding: "5vh 7vw" }}>
        <div style={{ marginBottom: "3vh" }}>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f59e0b", marginBottom: "1vh" }}>Permissionless Solver Marketplace</div>
          <div style={{ fontSize: "3.8vw", fontWeight: 900, lineHeight: 1.1, color: "#e8f0fe" }}>
            Anyone can be a solver. <span style={{ color: "#f59e0b" }}>Earn fees delivering native tokens.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "2.5vw", flex: 1 }}>

          {/* Left — How it works */}
          <div style={{ flex: 1.2, display: "flex", flexDirection: "column", gap: "1.5vh" }}>
            <div style={{ fontSize: "1.2vw", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Registration Flow</div>
            {[
              { step: "01", title: "Register via API", body: "POST /api/solver/register with name, fee%, supported routes. No permission needed — open to anyone.", color: "#f59e0b" },
              { step: "02", title: "Intent submitted", body: "When a user submits an intent matching your supported routes, you automatically enter the bid pool.", color: "#9945ff" },
              { step: "03", title: "Bid computed", body: "Your bid is computed from your registered fee. Custom solvers can also POST /api/solver/bid for dynamic pricing.", color: "#14f195" },
              { step: "04", title: "Win & deliver", body: "If your bid wins, you deliver native tokens to the user's address. Anchor escrow releases your fee upon proof.", color: "#0ea5e9" },
            ].map(item => (
              <div key={item.step} style={{ background: "#0d1629", borderRadius: "0.8vw", padding: "1.8vh 2vw", display: "flex", gap: "1.5vw", alignItems: "flex-start", border: `1px solid ${item.color}20` }}>
                <div style={{ fontSize: "2vw", fontWeight: 900, color: item.color, flexShrink: 0, lineHeight: 1 }}>{item.step}</div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 700, color: "#e8f0fe", marginBottom: "0.3vh" }}>{item.title}</div>
                  <div style={{ fontSize: "1.1vw", color: "#64748b", lineHeight: 1.4 }}>{item.body}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Right — Live solver leaderboard */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5vh" }}>
            <div style={{ fontSize: "1.2vw", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Solver Pool (Demo)</div>

            {[
              { name: "Alpha Solver", type: "Built-in", fee: "0.30%", routes: "SOL→BTC, SOL→ETH, SOL→SOL", rep: 98, color: "#94a3b8" },
              { name: "Beta Solver", type: "Built-in", fee: "0.25%", routes: "SOL→ETH, SOL→BASE, SOL→ARB", rep: 94, color: "#94a3b8" },
              { name: "Gamma Solver", type: "Built-in", fee: "0.50%", routes: "All routes", rep: 99, color: "#94a3b8" },
              { name: "🤖 AI Solver", type: "Claude Agent", fee: "Dynamic", routes: "All routes", rep: 96, color: "#9945ff", highlight: true },
              { name: "Delta Solver", type: "Custom ✓", fee: "0.18%", routes: "SOL↔ETH", rep: 87, color: "#f59e0b", custom: true },
              { name: "Epsilon Solver", type: "Custom ✓", fee: "0.35%", routes: "BTC heavy", rep: 82, color: "#f59e0b", custom: true },
            ].map(s => (
              <div key={s.name} style={{
                background: s.highlight ? "rgba(153,69,255,0.08)" : s.custom ? "rgba(245,158,11,0.05)" : "#0d1629",
                borderRadius: "0.6vw", padding: "1.2vh 1.5vw",
                border: `1px solid ${s.highlight ? "rgba(153,69,255,0.3)" : s.custom ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.05)"}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1vw" }}>
                  <div>
                    <div style={{ fontSize: "1.2vw", fontWeight: 700, color: s.color }}>{s.name}</div>
                    <div style={{ fontSize: "1vw", color: "#475569" }}>{s.routes}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "0.2vh", alignItems: "flex-end" }}>
                  <div style={{ fontSize: "1vw", color: "#e8f0fe", fontWeight: 600 }}>{s.fee}</div>
                  <div style={{ background: `${s.color}20`, color: s.color, fontSize: "0.85vw", padding: "1px 8px", borderRadius: "999px", fontWeight: 700 }}>{s.type}</div>
                </div>
              </div>
            ))}

            <div style={{ background: "rgba(245,158,11,0.06)", borderRadius: "0.6vw", padding: "1.2vh 1.5vw", border: "1px dashed rgba(245,158,11,0.3)", textAlign: "center" }}>
              <div style={{ fontSize: "1.1vw", color: "#f59e0b", fontWeight: 600 }}>+ Register your solver →</div>
              <div style={{ fontSize: "0.95vw", color: "#475569", marginTop: "0.3vh", fontFamily: "monospace" }}>POST /api/solver/register</div>
            </div>
          </div>

        </div>

        <div style={{ marginTop: "2vh", padding: "1.2vh 2vw", background: "rgba(245,158,11,0.06)", borderRadius: "0.6vw", border: "1px solid rgba(245,158,11,0.15)", textAlign: "center" }}>
          <div style={{ fontSize: "1.4vw", color: "#94a3b8" }}>
            Open solver market → more competition → better prices for users → more volume → more fee revenue for solvers
          </div>
        </div>
      </div>
    </div>
  );
}
