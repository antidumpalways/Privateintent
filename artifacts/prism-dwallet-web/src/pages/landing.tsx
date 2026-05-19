import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@/lib/wallet-context";

const P = "#7c3aed";
const M = "#10b981";
const BG = "#0a0b14";

function ShieldIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6L12 2z"
        fill={P} opacity="0.25"/>
      <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6L12 2z"
        stroke={P} strokeWidth="1.4" fill="none"/>
      <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
      </svg>
    ),
    title: "Encrypt FHE: MEV Shield",
    desc: "Your intent is encrypted on-chain before any solver sees it. Solvers bid on the hash only. Your amount, destination, and identity stay private until delivery.",
    badge: "Encrypt devnet",
    trust: "On-chain ciphertext verified",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.5"/>
      </svg>
    ),
    title: "Ika MPC: Threshold Co-Signing",
    desc: "Every intent is co-signed by Ika's MPC threshold network. No single party controls the key — your transaction only executes when both you and Ika's distributed nodes agree.",
    badge: "Ika devnet",
    trust: "MPC threshold signing, no single point of failure",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Blind Solver Auction",
    desc: "Multiple solvers bid blindly on your encrypted intent. Best output wins. You always get the optimal rate. Permissionless, anyone can register as a solver.",
    badge: "Open network",
    trust: "Blind auction, zero front-running",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 10h10M7 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: "Anchor Escrow: Trustless",
    desc: "Your funds lock in a Solana Anchor program PDA. The solver only gets paid after delivering proof of native token delivery on the destination chain.",
    badge: "Solana devnet",
    trust: "Zero-trust, enforced on-chain",
  },
];

const STEPS = [
  {
    icon: "👻",
    title: "Connect Phantom",
    desc: "One click. Phantom detects your wallet automatically. No new seed phrase, no new account.",
  },
  {
    icon: "🔗",
    title: "Create Ika dWallet",
    desc: "Ika DKG derives a cross-chain keypair from your Phantom authority. Controls native assets on any chain with one key.",
  },
  {
    icon: "🔒",
    title: "Submit Private Intent",
    desc: "Describe your swap in plain language. AI parses your intent, FHE seals it on-chain before any solver sees it. MEV bots see only ciphertext.",
  },
  {
    icon: "⚡",
    title: "Blind Solver Auction",
    desc: "Solvers compete on your encrypted order. No one knows your amount until the winner is locked in.",
  },
  {
    icon: "✅",
    title: "Trustless Settlement",
    desc: "Escrow releases only after the winning solver delivers native tokens via Ika MPC. Verified on-chain.",
  },
];

export default function Landing() {
  const [, navigate] = useLocation();
  const { connected, connectPhantom, connecting } = useWallet();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function handleLaunch() {
    if (!connected) {
      try { await connectPhantom(); } catch {}
    }
    navigate("/app");
  }

  const styles = `
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
    .hero-btn:hover{transform:translateY(-2px);box-shadow:0 8px 36px rgba(124,58,237,0.45)!important}
    .hero-btn{transition:all 0.2s ease!important}
    .feat-card:hover{background:rgba(255,255,255,0.045)!important;border-color:rgba(124,58,237,0.25)!important}
    .feat-card{transition:all 0.2s ease!important}
    .step-node{transition:border-color 0.2s}
    @media(max-width:600px){
      .nav-links{display:none!important}
      .nav-links-mobile{display:flex!important}
      .hero-h1{font-size:clamp(30px,9vw,48px)!important}
      .stats-row{flex-direction:column!important;gap:0!important}
    }
  `;

  return (
    <div style={{ background: BG, minHeight: "100vh", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{styles}</style>

      {/* Full-screen background image — more visible, text-friendly */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <img src="/bg-landing.jpg" alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.65 }} />
        {/* Dark overlay — lighter so background shows through more */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          background: `linear-gradient(to bottom, ${BG}aa 0%, ${BG}77 40%, ${BG}88 60%, ${BG}bb 100%)` }} />
      </div>

      {/* Navbar */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        background: scrolled ? "rgba(10,11,20,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
        transition: "all 0.3s", padding: "0 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: "60px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ShieldIcon />
          <span style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.4px", color: "#f1f5f9" }}>
            Private Intent
          </span>
        </div>
        <div className="nav-links" style={{ display: "flex", gap: "28px", alignItems: "center" }}>
          <a href="#how" style={{ color: "#64748b", fontSize: "14px", textDecoration: "none" }}>How it works</a>
          <a href="#features" style={{ color: "#64748b", fontSize: "14px", textDecoration: "none" }}>Features</a>
          <a href="#trust" style={{ color: "#64748b", fontSize: "14px", textDecoration: "none" }}>Privacy</a>
          <button onClick={handleLaunch} className="hero-btn" style={{
            background: P, color: "#fff", fontWeight: 700, fontSize: "13px",
            padding: "8px 20px", borderRadius: "8px", border: "none", cursor: "pointer",
          }}>
            {connected ? "Open App" : "Launch App"}
          </button>
        </div>
        <button onClick={handleLaunch} className="nav-links-mobile" style={{
          display: "none", background: P, color: "#fff", fontWeight: 700,
          fontSize: "13px", padding: "7px 16px", borderRadius: "8px", border: "none", cursor: "pointer",
        }}>
          {connected ? "Open" : "Launch"}
        </button>
      </nav>

      {/* Hero */}
      <section style={{ paddingTop: "130px", paddingBottom: "80px", textAlign: "center",
        position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "0 24px",
          animation: "rise 0.55s ease both" }}>

          {/* Hackathon badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "999px", padding: "5px 16px", fontSize: "12px",
            color: "#94a3b8", fontWeight: 500, marginBottom: "36px",
          }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: M,
              boxShadow: `0 0 6px ${M}`, display: "inline-block", animation: "pulse 2s infinite" }} />
            Colosseum Frontier Hackathon · Ika + Encrypt Track
          </div>

          {/* H1 */}
          <h1 className="hero-h1" style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 900,
            lineHeight: 1.08, letterSpacing: "-2px", margin: "0 0 28px" }}>
            <span style={{ color: "#f1f5f9" }}>Transact privately.</span>
            <br />
            <span style={{ color: P }}>No bridges. No leaks.</span>
          </h1>

          <p style={{ fontSize: "17px", color: "#64748b", lineHeight: 1.7, maxWidth: "520px",
            margin: "0 auto 48px", fontWeight: 400 }}>
            Seal your intent with FHE. Solvers bid blindly. Assets arrive natively.
          </p>

          {/* CTA */}
          <button onClick={handleLaunch} disabled={connecting} className="hero-btn" style={{
            background: P, color: "#fff", fontWeight: 700, fontSize: "17px",
            padding: "16px 44px", borderRadius: "12px", border: "none", cursor: "pointer",
            boxShadow: `0 0 48px ${P}38`, opacity: connecting ? 0.7 : 1,
            display: "inline-flex", alignItems: "center", gap: "10px",
          }}>
            {connecting ? (
              <>
                <span style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff", borderRadius: "50%", display: "inline-block" }} />
                Connecting...
              </>
            ) : connected ? "Open App →" : "Connect Phantom & Swap →"}
          </button>

          <p style={{ fontSize: "12px", color: "#334155", marginTop: "14px" }}>
            Free testnet demo · No real funds · Phantom required
          </p>

          {/* Stats row */}
          <div className="stats-row" style={{
            display: "inline-flex", marginTop: "56px",
            background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "14px", overflow: "hidden",
          }}>
            {[
              { val: "3", label: "Chains" },
              { val: "5", label: "Solvers" },
              { val: "0", label: "Bridges" },
              { val: "FHE Sealed", label: "Privacy" },
            ].map((s, i, arr) => (
              <div key={s.label} style={{
                padding: "18px 28px", textAlign: "center",
                borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#f1f5f9" }}>{s.val}</div>
                <div style={{ fontSize: "11px", color: "#334155", marginTop: "3px", fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Inside the App */}
      <section style={{ padding: "0 20px 80px", maxWidth: "1040px", margin: "0 auto",
        position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569",
            letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>INSIDE THE APP</div>
          <h2 style={{ fontSize: "30px", fontWeight: 800, letterSpacing: "-0.8px",
            color: "#f1f5f9", margin: 0 }}>What you can do from day one.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
          {[
            {
              icon: "🔒",
              title: "Private Swap",
              desc: "Swap tokens across chains without revealing your amount, destination, or identity. AI understands plain-language requests — just type what you want to do.",
            },
            {
              icon: "👻",
              title: "Private Drop",
              desc: "Send tokens to any address privately. The recipient receives native assets; no one watching the mempool can link sender to recipient.",
            },
            {
              icon: "🏦",
              title: "Shielded Vault",
              desc: "Hold cross-chain assets under one encrypted keypair. Your balances are shielded by FHE — visible only to you, never to a third-party custodian.",
            },
          ].map((card) => (
            <div key={card.title} className="feat-card" style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "16px", padding: "28px 24px",
            }}>
              <div style={{ fontSize: "28px", marginBottom: "14px" }}>{card.icon}</div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: "#f1f5f9",
                marginBottom: "10px" }}>{card.title}</div>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.75, margin: 0 }}>
                {card.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ padding: "80px 20px", maxWidth: "620px", margin: "0 auto",
        position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: "52px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569",
            letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-1px", color: "#f1f5f9", margin: 0 }}>
            Five steps. Fully trustless.
          </h2>
        </div>

        <div style={{ position: "relative" }}>
          {/* Connector line */}
          <div style={{
            position: "absolute", left: "19px", top: "20px", bottom: "20px", width: "1px",
            background: "rgba(255,255,255,0.06)",
          }} />

          {STEPS.map((s, i) => (
            <div key={s.title} style={{
              display: "flex", gap: "20px", alignItems: "flex-start",
              paddingBottom: i < STEPS.length - 1 ? "32px" : "0",
              animation: `rise 0.45s ${i * 0.07}s ease both`,
            }}>
              <div className="step-node" style={{
                width: "40px", height: "40px", flexShrink: 0,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "50%", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: "17px", position: "relative", zIndex: 2,
              }}>
                {s.icon}
              </div>
              <div style={{ paddingTop: "8px" }}>
                <div style={{ fontWeight: 600, fontSize: "15px", color: "#f1f5f9",
                  marginBottom: "5px" }}>{s.title}</div>
                <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.75 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ padding: "40px 20px 80px", maxWidth: "1040px",
        margin: "0 auto", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569",
            letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>TECHNOLOGY</div>
          <h2 style={{ fontSize: "30px", fontWeight: 800, letterSpacing: "-0.8px",
            color: "#f1f5f9", margin: 0 }}>Built different.</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {FEATURES.map((f, i) => (
            <div key={f.title} className="feat-card" style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "16px", padding: "24px",
              animation: `rise 0.45s ${i * 0.07}s ease both`,
            }}>
              <div style={{
                width: "40px", height: "40px", borderRadius: "10px",
                background: `${P}12`, border: `1px solid ${P}20`,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: "16px", color: P,
              }}>
                {f.icon}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px",
                marginBottom: "8px", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: "14px", color: "#f1f5f9" }}>{f.title}</span>
                <span style={{ fontSize: "10px", fontWeight: 500,
                  background: "rgba(255,255,255,0.05)", color: "#475569",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "999px", padding: "1px 8px" }}>{f.badge}</span>
              </div>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.7, margin: "0 0 12px" }}>
                {f.desc}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "4px", height: "4px", borderRadius: "50%",
                  background: "#334155", display: "inline-block" }} />
                <span style={{ fontSize: "11px", color: "#334155" }}>{f.trust}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy proof */}
      <section id="trust" style={{ padding: "20px 20px 80px", position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "20px", padding: "48px 40px", textAlign: "center",
          }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569",
              letterSpacing: "2px", textTransform: "uppercase", marginBottom: "16px" }}>PRIVACY PROOF</div>
            <h2 style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-0.6px",
              color: "#f1f5f9", marginBottom: "10px" }}>
              Your privacy, proven on-chain.
            </h2>
            <p style={{ fontSize: "14px", color: "#475569", lineHeight: 1.75,
              maxWidth: "480px", margin: "0 auto 36px" }}>
              Three independent mechanisms make it mathematically impossible for anyone,
              including us, to see your intent before the solver is committed.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              {[
                { icon: "🔐", label: "FHE Encrypted", sub: "Intent sealed before solvers see it" },
                { icon: "⚓", label: "Escrow-Locked", sub: "Funds held in Anchor PDA until delivery" },
                { icon: "🔑", label: "Viewing Key Proof", sub: "Solver gets key only after winning bid" },
              ].map(t => (
                <div key={t.label} style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "14px", padding: "20px 16px",
                }}>
                  <div style={{ fontSize: "24px", marginBottom: "10px" }}>{t.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "#cbd5e1",
                    marginBottom: "4px" }}>{t.label}</div>
                  <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>{t.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ padding: "20px 20px 100px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <h2 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.8px",
          color: "#f1f5f9", marginBottom: "10px" }}>
          Ready to swap without bridges?
        </h2>
        <p style={{ color: "#475569", fontSize: "14px", marginBottom: "28px" }}>
          Connect Phantom, create your dWallet in seconds, submit your first private intent.
        </p>
        <button onClick={handleLaunch} disabled={connecting} className="hero-btn" style={{
          background: P, color: "#fff", fontWeight: 700, fontSize: "16px",
          padding: "14px 40px", borderRadius: "12px", border: "none", cursor: "pointer",
          boxShadow: `0 0 40px ${P}35`,
        }}>
          {connecting ? "Connecting..." : "Launch Private Intent →"}
        </button>
        <div style={{ marginTop: "24px", display: "inline-flex", flexDirection: "column",
          gap: "8px", textAlign: "left" }}>
          {[
            "Connect Phantom in one click — no new seed phrase",
            "Create your Ika dWallet in seconds",
            "Submit your first private swap immediately",
          ].map((bullet) => (
            <div key={bullet} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: M, fontSize: "14px", fontWeight: 700 }}>✓</span>
              <span style={{ fontSize: "13px", color: "#475569" }}>{bullet}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.05)", padding: "20px 32px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "12px", position: "relative", zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ShieldIcon />
          <span style={{ fontWeight: 600, fontSize: "13px", color: "#334155" }}>Private Intent</span>
        </div>
        <div style={{ fontSize: "12px", color: "#1e293b" }}>
          Colosseum Frontier Hackathon 2026 · Ika + Encrypt Track · Solana Devnet
        </div>
      </footer>
    </div>
  );
}
