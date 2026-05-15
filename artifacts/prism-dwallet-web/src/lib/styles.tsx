import type React from "react";
import { P, M, BG } from "./constants";

/** Card container — dark glass panel */
export const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px", padding: "28px",
};

/** Styled input field */
export const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px", padding: "10px 14px", color: "#e2e8f0", fontSize: "14px",
  width: "100%", boxSizing: "border-box", outline: "none",
};

/** Primary action button (purple → emerald gradient) */
export const primaryBtn: React.CSSProperties = {
  background: `linear-gradient(135deg, ${P}, ${M})`,
  color: "#fff", fontWeight: 800, fontSize: "16px",
  padding: "15px 28px", borderRadius: "12px", border: "none", cursor: "pointer",
  width: "100%", transition: "opacity 0.2s, transform 0.15s",
  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
};

/** Format address: 0xk8s7…k3j9 */
export const addrFmt = (s: string) => s ? `${s.slice(0,4)}…${s.slice(-4)}` : "";

/** Chip badge — inline colored pill */
export function chip(txt: string, color: string, style?: React.CSSProperties): JSX.Element {
  const P = "#7c3aed"; // local fallback
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, letterSpacing: "0.4px",
      background: `${color}1a`, color, border: `1px solid ${color}35`,
      borderRadius: "999px", padding: "2px 9px", ...style,
    }}>
      {txt}
    </span>
  );
}

/** Global keyframes and responsive styles (injected as <style>) */
export const GL_KEYFRAMES = `
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  select option{background:#0e1122;color:#e2e8f0}
  .pi-input:focus{border-color:${P}60!important;box-shadow:0 0 0 3px ${P}14}
  .pri-btn:hover{opacity:0.9;transform:translateY(-1px)}
  .pri-btn:active{transform:translateY(0)}
  .step-label{display:block}
  @media(max-width:480px){.step-label{display:none}}
  .mobile-bottom-bar{display:none}
  @media(max-width:600px){
    .mobile-bottom-bar{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:50;
      padding:12px 16px 20px;background:linear-gradient(to top,${BG} 60%,transparent);
      flex-direction:column;gap:8px}
    .hide-on-mobile{display:none!important}
    .main-scroll-pad{padding-bottom:120px!important}
  }
  .sidebar-nav-btn:hover{background:rgba(255,255,255,0.04)!important;color:#94a3b8!important}
  @media(max-width:600px){
    aside{display:none!important}
    .main-scroll-pad{padding-left:16px!important;padding-right:16px!important}
  }
`;