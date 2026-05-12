export default function Slide3Solution() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#050811" }}>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #14f195, #9945ff, transparent)" }} />
      <div className="absolute" style={{ bottom: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #9945ff, #14f195, transparent)" }} />

      <div className="absolute inset-0 flex flex-col" style={{ padding: "5vh 7vw" }}>
        <div style={{ marginBottom: "3vh" }}>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#14f195", marginBottom: "1vh" }}>
            The Solution
          </div>
          <div style={{ fontSize: "3.8vw", fontWeight: 900, lineHeight: 1.05, color: "#e8f0fe" }}>
            One intent. Zero bridges. No leaks.
          </div>
        </div>

        {/* Flow arrow */}
        <div style={{ display: "flex", alignItems: "center", gap: "1vw", marginBottom: "2.5vh", overflowX: "auto" }}>
          {[
            { label: "Phantom", sub: "Connect", color: "#9945ff" },
            { label: "Ika DKG", sub: "dWallet created", color: "#9945ff" },
            { label: "Encrypt FHE", sub: "Intent sealed", color: "#14f195" },
            { label: "Solver Race", sub: "4 solvers bid", color: "#f59e0b" },
            { label: "Anchor Escrow", sub: "SOL locked", color: "#0ea5e9" },
            { label: "Ika MPC", sub: "Native delivery", color: "#9945ff" },
            { label: "Settled", sub: "Escrow released", color: "#14f195" },
          ].reduce((acc, step, i, arr) => {
            acc.push(
              <div key={step.label} style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontSize: "1.1vw", fontWeight: 700, color: step.color }}>{step.label}</div>
                <div style={{ fontSize: "0.95vw", color: "#475569" }}>{step.sub}</div>
              </div>
            );
            if (i < arr.length - 1) acc.push(
              <div key={`arr-${i}`} style={{ color: "#334155", fontSize: "1.5vw", flexShrink: 0 }}>→</div>
            );
            return acc;
          }, [] as React.ReactElement[])}
        </div>

        <div style={{ display: "flex", gap: "2vw", flex: 1 }}>

          {/* Pillar 1 — Ika */}
          <div style={{ flex: 1, background: "linear-gradient(135deg, #0d0a1f, #130d1f)", borderRadius: "1vw", padding: "2.5vh 2vw", display: "flex", flexDirection: "column", gap: "1.5vh", border: "1px solid rgba(153,69,255,0.2)" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#9945ff" }}>Ika dWallet — Bridgeless Custody</div>
            <div style={{ fontSize: "1.9vw", fontWeight: 800, color: "#e8f0fe", lineHeight: 1.2 }}>One key. All chains. Native.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1vh", flex: 1 }}>
              {[
                { title: "MPC DKG Protocol", body: "Ika runs distributed key generation — one Secp256k1 key controls ETH + BTC, one Curve25519 key controls SOL. Bound to your Phantom pubkey." },
                { title: "No wrapped tokens", body: "Solver delivers native BTC to your Bitcoin address, native ETH to your Ethereum address. Zero lock-and-mint, zero bridge risk." },
                { title: "Threshold signing", body: "No single party holds the full key. 2PC-MPC ensures even Ika cannot move your assets without user co-sign." },
              ].map(item => (
                <div key={item.title} style={{ background: "#0d1629", borderRadius: "0.5vw", padding: "1.2vh 1.5vw" }}>
                  <div style={{ fontSize: "1.2vw", fontWeight: 600, color: "#9945ff", marginBottom: "0.3vh" }}>{item.title}</div>
                  <div style={{ fontSize: "1.1vw", color: "#64748b", lineHeight: 1.4 }}>{item.body}</div>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(153,69,255,0.08)", borderRadius: "0.4vw", padding: "0.8vh 1.2vw", border: "1px solid rgba(153,69,255,0.2)" }}>
              <div style={{ fontSize: "1vw", color: "#9945ff", fontFamily: "monospace" }}>pre-alpha-dev-1.ika.ika-network.net:443</div>
            </div>
          </div>

          {/* Pillar 2 — Encrypt */}
          <div style={{ flex: 1, background: "linear-gradient(135deg, #0a1a0e, #0d1a14)", borderRadius: "1vw", padding: "2.5vh 2vw", display: "flex", flexDirection: "column", gap: "1.5vh", border: "1px solid rgba(20,241,149,0.15)" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#14f195" }}>Encrypt FHE — MEV Shield</div>
            <div style={{ fontSize: "1.9vw", fontWeight: 800, color: "#e8f0fe", lineHeight: 1.2 }}>Intent sealed before solvers see anything.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1vh", flex: 1 }}>
              {[
                { title: "FHE before routing", body: "Intent payload (amount, tokens, destination) is encrypted with Encrypt FHE devnet before any solver receives it. Solvers only see a hash." },
                { title: "MEV impossible", body: "No plaintext in mempool = no front-running. Sandwich attacks require seeing your intent — they can't." },
                { title: "Proof of intent", body: "onChainId from Encrypt devnet proves your intent existed before execution. Immutable audit trail." },
              ].map(item => (
                <div key={item.title} style={{ background: "#0d1629", borderRadius: "0.5vw", padding: "1.2vh 1.5vw" }}>
                  <div style={{ fontSize: "1.2vw", fontWeight: 600, color: "#14f195", marginBottom: "0.3vh" }}>{item.title}</div>
                  <div style={{ fontSize: "1.1vw", color: "#64748b", lineHeight: 1.4 }}>{item.body}</div>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(20,241,149,0.06)", borderRadius: "0.4vw", padding: "0.8vh 1.2vw", border: "1px solid rgba(20,241,149,0.15)" }}>
              <div style={{ fontSize: "1vw", color: "#14f195", fontFamily: "monospace" }}>pre-alpha-dev-1.encrypt.ika-network.net:443</div>
            </div>
          </div>

          {/* Pillar 3 — Solver + Escrow */}
          <div style={{ flex: 1, background: "linear-gradient(135deg, #0a0e1a, #0d1020)", borderRadius: "1vw", padding: "2.5vh 2vw", display: "flex", flexDirection: "column", gap: "1.5vh", border: "1px solid rgba(99,102,241,0.2)" }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#6366f1" }}>Solver Race + Anchor Escrow</div>
            <div style={{ fontSize: "1.9vw", fontWeight: 800, color: "#e8f0fe", lineHeight: 1.2 }}>Competitive market. Trustless settlement.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1vh", flex: 1 }}>
              {[
                { title: "4 solvers compete", body: "Alpha, Beta, Gamma (static) + AI Solver (Claude-powered) bid simultaneously. User always gets the best output amount." },
                { title: "Anchor escrow", body: "SOL locked in Anchor PDA at accept. Released only after solver posts valid delivery proof. No trust required." },
                { title: "Permissionless", body: "Any external solver can register via POST /api/solver/register — earn fees by delivering native tokens faster and cheaper." },
              ].map(item => (
                <div key={item.title} style={{ background: "#0d1629", borderRadius: "0.5vw", padding: "1.2vh 1.5vw" }}>
                  <div style={{ fontSize: "1.2vw", fontWeight: 600, color: "#6366f1", marginBottom: "0.3vh" }}>{item.title}</div>
                  <div style={{ fontSize: "1.1vw", color: "#64748b", lineHeight: 1.4 }}>{item.body}</div>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(99,102,241,0.08)", borderRadius: "0.4vw", padding: "0.8vh 1.2vw", border: "1px solid rgba(99,102,241,0.2)" }}>
              <div style={{ fontSize: "1vw", color: "#6366f1", fontFamily: "monospace" }}>Anchor · Solana Devnet · SOL escrow PDA</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
