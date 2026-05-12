export default function Slide5Architecture() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#050811" }}>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #9945ff, transparent)" }} />

      <div className="absolute inset-0 flex flex-col" style={{ padding: "5vh 7vw" }}>
        <div style={{ marginBottom: "3vh" }}>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#9945ff", marginBottom: "1vh" }}>Architecture</div>
          <div style={{ fontSize: "3.8vw", fontWeight: 900, lineHeight: 1.1, color: "#e8f0fe" }}>Full transaction flow</div>
        </div>

        {/* Main flow diagram */}
        <div style={{ display: "flex", alignItems: "stretch", gap: "1.2vw", flex: 1 }}>

          {/* Step 1 */}
          <div style={{ flex: 1, background: "#0d1629", borderRadius: "0.8vw", padding: "2vh 1.5vw", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", border: "1px solid rgba(153,69,255,0.25)", gap: "1vh" }}>
            <div style={{ width: "4vw", height: "4vw", borderRadius: "50%", background: "linear-gradient(135deg,#9945ff,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "1.8vw" }}>👻</span>
            </div>
            <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#e8f0fe" }}>Phantom</div>
            <div style={{ fontSize: "1.05vw", color: "#475569", lineHeight: 1.4 }}>User connects wallet. Phantom pubkey becomes dWallet owner.</div>
            <div style={{ marginTop: "auto", background: "rgba(153,69,255,0.1)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", fontSize: "0.9vw", color: "#9945ff", fontFamily: "monospace" }}>Step 1</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", color: "#334155", fontSize: "1.5vw", flexShrink: 0 }}>→</div>

          {/* Step 2 */}
          <div style={{ flex: 1, background: "#0d1629", borderRadius: "0.8vw", padding: "2vh 1.5vw", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", border: "1px solid rgba(153,69,255,0.4)", boxShadow: "0 0 20px rgba(153,69,255,0.1)", gap: "1vh" }}>
            <div style={{ width: "4vw", height: "4vw", borderRadius: "0.8vw", background: "#070d1f", border: "2px solid #9945ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: "1.1vw", fontWeight: 900, color: "#9945ff" }}>IKA</div>
            </div>
            <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#9945ff" }}>Ika DKG</div>
            <div style={{ fontSize: "1.05vw", color: "#475569", lineHeight: 1.4 }}>MPC generates keypair. One key → ETH+BTC+SOL native addresses.</div>
            <div style={{ marginTop: "auto", background: "rgba(153,69,255,0.1)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", fontSize: "0.9vw", color: "#9945ff", fontFamily: "monospace" }}>Step 2 · dWallet</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", color: "#334155", fontSize: "1.5vw", flexShrink: 0 }}>→</div>

          {/* Step 3 */}
          <div style={{ flex: 1, background: "#0a1a0e", borderRadius: "0.8vw", padding: "2vh 1.5vw", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", border: "1px solid rgba(20,241,149,0.3)", gap: "1vh" }}>
            <div style={{ width: "4vw", height: "4vw", borderRadius: "0.8vw", background: "#0d1629", border: "2px solid #14f195", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: "1vw", fontWeight: 900, color: "#14f195" }}>FHE</div>
            </div>
            <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#14f195" }}>Encrypt FHE</div>
            <div style={{ fontSize: "1.05vw", color: "#475569", lineHeight: 1.4 }}>Intent sealed on Encrypt devnet. Solvers see only hash.</div>
            <div style={{ marginTop: "auto", background: "rgba(20,241,149,0.08)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", fontSize: "0.9vw", color: "#14f195", fontFamily: "monospace" }}>Step 3 · MEV Shield</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", color: "#334155", fontSize: "1.5vw", flexShrink: 0 }}>→</div>

          {/* Step 4 — Solver Race */}
          <div style={{ flex: 1.3, background: "#0d1629", borderRadius: "0.8vw", padding: "2vh 1.5vw", display: "flex", flexDirection: "column", border: "1px solid rgba(245,158,11,0.25)", gap: "1vh" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#f59e0b", marginBottom: "0.8vh" }}>Solver Race</div>
            </div>
            {[
              { name: "Alpha Solver", fee: "0.30%", color: "#94a3b8" },
              { name: "Beta Solver", fee: "0.25%", color: "#94a3b8" },
              { name: "Gamma Solver", fee: "0.50%", color: "#94a3b8" },
              { name: "🤖 AI Solver", fee: "0.22%", color: "#9945ff", winner: true },
            ].map(s => (
              <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: s.winner ? "rgba(153,69,255,0.08)" : "rgba(255,255,255,0.02)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", border: `1px solid ${s.winner ? "rgba(153,69,255,0.3)" : "transparent"}` }}>
                <div style={{ fontSize: "1vw", fontWeight: s.winner ? 700 : 400, color: s.color }}>{s.name}</div>
                <div style={{ fontSize: "1vw", color: s.winner ? "#14f195" : "#475569" }}>{s.fee}{s.winner ? " 🏆" : ""}</div>
              </div>
            ))}
            <div style={{ marginTop: "auto", background: "rgba(245,158,11,0.08)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", fontSize: "0.9vw", color: "#f59e0b", fontFamily: "monospace", textAlign: "center" }}>Step 4 · Best bid wins</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", color: "#334155", fontSize: "1.5vw", flexShrink: 0 }}>→</div>

          {/* Step 5 — Anchor Escrow */}
          <div style={{ flex: 1, background: "#0d1629", borderRadius: "0.8vw", padding: "2vh 1.5vw", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", border: "1px solid rgba(14,165,233,0.25)", gap: "1vh" }}>
            <div style={{ width: "4vw", height: "4vw", borderRadius: "50%", background: "linear-gradient(135deg,#0ea5e9,#38bdf8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "1.8vw" }}>🔒</span>
            </div>
            <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#0ea5e9" }}>Anchor Escrow</div>
            <div style={{ fontSize: "1.05vw", color: "#475569", lineHeight: 1.4 }}>SOL locked in PDA. Released only after delivery proof verified.</div>
            <div style={{ marginTop: "auto", background: "rgba(14,165,233,0.08)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", fontSize: "0.9vw", color: "#0ea5e9", fontFamily: "monospace" }}>Step 5 · Trustless</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", color: "#334155", fontSize: "1.5vw", flexShrink: 0 }}>→</div>

          {/* Step 6 — Delivery */}
          <div style={{ flex: 1, background: "#0a1a0e", borderRadius: "0.8vw", padding: "2vh 1.5vw", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", border: "1px solid rgba(20,241,149,0.4)", boxShadow: "0 0 20px rgba(20,241,149,0.08)", gap: "1vh" }}>
            <div style={{ width: "4vw", height: "4vw", borderRadius: "50%", background: "linear-gradient(135deg,#14f195,#0d9488)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "1.8vw" }}>✅</span>
            </div>
            <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#14f195" }}>Settled</div>
            <div style={{ fontSize: "1.05vw", color: "#475569", lineHeight: 1.4 }}>Native tokens delivered via Ika MPC. Escrow released to solver.</div>
            <div style={{ marginTop: "auto", background: "rgba(20,241,149,0.08)", borderRadius: "0.4vw", padding: "0.5vh 0.8vw", fontSize: "0.9vw", color: "#14f195", fontFamily: "monospace" }}>Step 6 · ~8 seconds</div>
          </div>

        </div>

        {/* Bottom note */}
        <div style={{ marginTop: "2vh", padding: "1.2vh 2vw", background: "rgba(153,69,255,0.05)", borderRadius: "0.6vw", border: "1px solid rgba(153,69,255,0.15)", display: "flex", gap: "3vw", alignItems: "center", justifyContent: "center" }}>
          {[
            { label: "BTC Testnet3", color: "#f59e0b" },
            { label: "ETH Sepolia", color: "#6366f1" },
            { label: "Base Sepolia", color: "#0ea5e9" },
            { label: "Arb Sepolia", color: "#14f195" },
            { label: "SOL Devnet", color: "#9945ff" },
          ].map(c => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: "0.5vw" }}>
              <div style={{ width: "0.6vw", height: "0.6vw", borderRadius: "50%", background: c.color }} />
              <div style={{ fontSize: "1.2vw", color: "#94a3b8" }}>{c.label}</div>
            </div>
          ))}
          <div style={{ fontSize: "1.2vw", color: "#475569" }}>— all chains natively supported, zero bridges</div>
        </div>
      </div>
    </div>
  );
}
