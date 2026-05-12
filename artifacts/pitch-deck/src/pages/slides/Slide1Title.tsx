export default function Slide1Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#050811" }}>
      {/* Ambient glow */}
      <div className="absolute" style={{ top: "-10%", left: "55%", width: "55vw", height: "80vh", background: "radial-gradient(ellipse, rgba(153,69,255,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div className="absolute" style={{ bottom: "-5%", left: "30%", width: "40vw", height: "50vh", background: "radial-gradient(ellipse, rgba(20,241,149,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Left accent line */}
      <div className="absolute" style={{ left: "5vw", top: "12%", bottom: "12%", width: "2px", background: "linear-gradient(to bottom, transparent, #9945ff, #14f195, transparent)" }} />

      {/* Top bar */}
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: "0.35vh", background: "linear-gradient(to right, transparent, #9945ff 40%, #14f195 60%, transparent)" }} />

      <div className="absolute inset-0 flex flex-col justify-between" style={{ padding: "8vh 8vw 7vh 9vw" }}>
        <div>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, letterSpacing: "0.25em", textTransform: "uppercase", color: "#14f195", marginBottom: "3vh" }}>
            Colosseum Frontier Hackathon 2026 · Ika + Encrypt Track
          </div>

          <div style={{ fontSize: "7vw", fontWeight: 900, lineHeight: 0.95, letterSpacing: "-0.02em", color: "#e8f0fe", marginBottom: "2.5vh" }}>
            Private
            <br />
            <span style={{ background: "linear-gradient(90deg, #9945ff, #14f195)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Intent
            </span>
          </div>

          <div style={{ fontSize: "2.4vw", fontWeight: 600, color: "#94a3b8", maxWidth: "52vw", lineHeight: 1.25, marginBottom: "3vh" }}>
            Swap any asset. No bridges. No leaks.
          </div>

          <div style={{ fontSize: "1.6vw", color: "#64748b", maxWidth: "48vw", lineHeight: 1.6 }}>
            The first privacy-first, bridgeless intent engine on Solana.
            Powered by <span style={{ color: "#9945ff", fontWeight: 700 }}>Ika MPC</span>,{" "}
            <span style={{ color: "#14f195", fontWeight: 700 }}>Encrypt FHE</span>, and{" "}
            <span style={{ color: "#6366f1", fontWeight: 700 }}>Claude AI</span>.
          </div>
        </div>

        {/* Bottom stat row */}
        <div style={{ display: "flex", alignItems: "center", gap: "3.5vw" }}>
          {[
            { value: "0", label: "Bridges used", color: "#14f195" },
            { value: "FHE", label: "Intent privacy", color: "#9945ff" },
            { value: "MPC", label: "Native signing", color: "#6366f1" },
            { value: "4×", label: "Solver competition", color: "#f59e0b" },
            { value: "AI", label: "Claude-powered", color: "#0ea5e9" },
          ].map((stat, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.3vh" }}>
              <div style={{ fontSize: "2.2vw", fontWeight: 900, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: "1.2vw", color: "#475569" }}>{stat.label}</div>
            </div>
          )).reduce((acc, el, i, arr) => {
            acc.push(el);
            if (i < arr.length - 1) acc.push(<div key={`sep-${i}`} style={{ width: "1px", height: "4vh", background: "#1e293b" }} />);
            return acc;
          }, [] as React.ReactElement[])}
        </div>
      </div>
    </div>
  );
}
