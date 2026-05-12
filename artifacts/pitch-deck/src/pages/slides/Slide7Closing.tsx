export default function Slide7Closing() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#050811" }}>
      {/* Ambient glows */}
      <div className="absolute" style={{ top: "-20%", right: "-10%", width: "60vw", height: "80vh", background: "radial-gradient(ellipse, rgba(153,69,255,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div className="absolute" style={{ bottom: "-10%", left: "20%", width: "50vw", height: "60vh", background: "radial-gradient(ellipse, rgba(20,241,149,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.5vh", background: "linear-gradient(to right, #9945ff, #14f195)" }} />
      <div className="absolute" style={{ bottom: 0, left: 0, right: 0, height: "0.5vh", background: "linear-gradient(to right, #14f195, #9945ff)" }} />

      <div className="absolute inset-0 flex flex-col justify-between" style={{ padding: "7vh 7vw" }}>

        <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#9945ff" }}>
          Colosseum Frontier Hackathon 2026
        </div>

        <div>
          <div style={{ fontSize: "5.5vw", fontWeight: 900, lineHeight: 1.0, color: "#e8f0fe", marginBottom: "2vh", maxWidth: "70vw" }}>
            Swap any asset.
            <br />
            <span style={{ background: "linear-gradient(90deg, #9945ff, #14f195)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              No bridges. No leaks.
            </span>
          </div>
          <div style={{ fontSize: "1.8vw", color: "#64748b", maxWidth: "55vw", lineHeight: 1.55 }}>
            Private Intent is the first bridgeless, privacy-first intent engine on Solana — combining Ika MPC native signing, Encrypt FHE sealed intents, a permissionless solver marketplace, and four AI pillars into a single swap flow.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>

          {/* Tech stack summary */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2vh" }}>
            {[
              { dot: "linear-gradient(135deg,#9945ff,#7c3aed)", title: "Ika MPC DKG", sub: "One keypair → ETH + BTC + SOL native · Threshold signing · Devnet gRPC" },
              { dot: "linear-gradient(135deg,#14f195,#0d9488)", title: "Encrypt FHE", sub: "Intent sealed before routing · MEV impossible · onChainId proof" },
              { dot: "linear-gradient(135deg,#6366f1,#818cf8)", title: "Claude AI (4 pillars)", sub: "Parse · Optimize · AI Solver · Dispute Judge" },
              { dot: "linear-gradient(135deg,#0ea5e9,#38bdf8)", title: "Anchor Escrow + Permissionless Solvers", sub: "Trustless settlement · Open solver registry · 6 solvers in demo" },
            ].map(item => (
              <div key={item.title} style={{ display: "flex", alignItems: "center", gap: "1.5vw" }}>
                <div style={{ width: "3.5vh", height: "3.5vh", borderRadius: "50%", background: item.dot, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.6vw", fontWeight: 700, color: "#e8f0fe" }}>{item.title}</div>
                  <div style={{ fontSize: "1.25vw", color: "#475569" }}>{item.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Right — Final branding */}
          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "0.8vh", alignItems: "flex-end" }}>
            <div style={{ fontSize: "4vw", fontWeight: 900, letterSpacing: "-0.02em", background: "linear-gradient(135deg, #9945ff, #14f195)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>
              Private Intent
            </div>
            <div style={{ fontSize: "1.4vw", color: "#64748b" }}>Bridges: 0</div>
            <div style={{ fontSize: "1.4vw", color: "#64748b" }}>Wrapped tokens: 0</div>
            <div style={{ fontSize: "1.6vw", color: "#14f195", fontWeight: 700 }}>MEV extracted: 0</div>
            <div style={{ marginTop: "1.5vh", padding: "1vh 2vw", background: "linear-gradient(135deg,#9945ff,#14f195)", borderRadius: "0.6vw" }}>
              <div style={{ fontSize: "1.5vw", fontWeight: 800, color: "#000" }}>Ika + Encrypt Track ✓</div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
