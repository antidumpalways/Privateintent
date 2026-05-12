export default function Slide2Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #050811 0%, #0a1020 100%)" }}>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #ef4444, transparent)" }} />

      <div className="absolute inset-0 flex flex-col" style={{ padding: "5.5vh 7vw" }}>
        <div style={{ marginBottom: "4vh" }}>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#ef4444", marginBottom: "1.5vh" }}>
            The Problem
          </div>
          <div style={{ fontSize: "4vw", fontWeight: 900, lineHeight: 1.05, color: "#e8f0fe" }}>
            Three broken fundamentals.
            <span style={{ color: "#ef4444" }}> All exploitable.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "2vw", flex: 1 }}>

          {/* Problem 1 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5vh" }}>
            <div style={{ background: "#0d1629", borderRadius: "0.8vw", padding: "2.5vh 2vw", borderTop: "3px solid #ef4444", flex: 1 }}>
              <div style={{ fontSize: "3vw", fontWeight: 900, color: "#ef4444", lineHeight: 1, marginBottom: "0.8vh" }}>$2.8B</div>
              <div style={{ fontSize: "1.7vw", fontWeight: 700, color: "#e8f0fe", marginBottom: "1vh" }}>Bridge Exploits — 2024</div>
              <div style={{ fontSize: "1.35vw", color: "#64748b", lineHeight: 1.5, marginBottom: "1.5vh" }}>
                Every cross-chain swap today routes through a bridge. Bridges are the #1 hack vector in crypto — lock-and-mint creates honeypots.
              </div>
              {["Ronin: $625M", "Wormhole: $320M", "Nomad: $190M", "Multichain: $130M"].map(t => (
                <div key={t} style={{ fontSize: "1.2vw", color: "#475569", padding: "2px 0" }}>⚠ {t}</div>
              ))}
            </div>
          </div>

          <div style={{ width: "1px", background: "linear-gradient(to bottom, transparent, #1e293b, transparent)", flexShrink: 0 }} />

          {/* Problem 2 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5vh" }}>
            <div style={{ background: "#0d1629", borderRadius: "0.8vw", padding: "2.5vh 2vw", borderTop: "3px solid #f59e0b", flex: 1 }}>
              <div style={{ fontSize: "3vw", fontWeight: 900, color: "#f59e0b", lineHeight: 1, marginBottom: "0.8vh" }}>$1.3B+</div>
              <div style={{ fontSize: "1.7vw", fontWeight: 700, color: "#e8f0fe", marginBottom: "1vh" }}>MEV Extracted — Annually</div>
              <div style={{ fontSize: "1.35vw", color: "#64748b", lineHeight: 1.5, marginBottom: "1.5vh" }}>
                Every DeFi trade is public before it confirms. MEV bots read your intent from the mempool and front-run you in the same block.
              </div>
              <div style={{ background: "#111c3a", borderRadius: "0.5vw", padding: "1.2vh 1.5vw" }}>
                <div style={{ fontSize: "1.2vw", color: "#94a3b8", fontFamily: "monospace" }}>
                  {"// mempool: visible to everyone"}
                  <br />{"{ swap: SOL→BTC, amount: 50 SOL }"}
                  <br /><span style={{ color: "#ef4444" }}>{"// sandwich bot executes first"}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ width: "1px", background: "linear-gradient(to bottom, transparent, #1e293b, transparent)", flexShrink: 0 }} />

          {/* Problem 3 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5vh" }}>
            <div style={{ background: "#0d1629", borderRadius: "0.8vw", padding: "2.5vh 2vw", borderTop: "3px solid #64748b", flex: 1 }}>
              <div style={{ fontSize: "3vw", fontWeight: 900, color: "#94a3b8", lineHeight: 1, marginBottom: "0.8vh" }}>5+</div>
              <div style={{ fontSize: "1.7vw", fontWeight: 700, color: "#e8f0fe", marginBottom: "1vh" }}>Wallets Per User</div>
              <div style={{ fontSize: "1.35vw", color: "#64748b", lineHeight: 1.5, marginBottom: "1.5vh" }}>
                ETH, BTC, SOL, Base, Arbitrum — each chain needs its own wallet, seed phrase, and RPC. Cross-chain UX is a disaster.
              </div>
              {["MetaMask for EVM", "Phantom for SOL", "Electrum for BTC", "Bridge UI to connect them", "Hope nothing gets hacked"].map(t => (
                <div key={t} style={{ fontSize: "1.15vw", color: "#475569", padding: "2px 0" }}>→ {t}</div>
              ))}
            </div>
          </div>

        </div>

        <div style={{ marginTop: "2.5vh", padding: "1.8vh 2vw", background: "rgba(239,68,68,0.06)", borderRadius: "0.6vw", border: "1px solid rgba(239,68,68,0.2)" }}>
          <div style={{ fontSize: "1.6vw", color: "#e8f0fe", textAlign: "center" }}>
            These aren't UI problems. They're infrastructure problems. Ika + Encrypt solve them at the protocol level.
          </div>
        </div>
      </div>
    </div>
  );
}
