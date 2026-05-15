import React from "react";
import { P, M } from "../lib/constants";

interface StepIndicatorProps {
  current: string;
}

export function StepIndicator({ current }: StepIndicatorProps) {
  const steps = [
    { key: "connect", label: "Connect", short: "1" },
    { key: "dwallet", label: "dWallet", short: "2" },
  ];
  const idx = steps.findIndex(s => s.key === current);

  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "32px" }}>
      {steps.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <div style={{
                width: "34px", height: "34px", borderRadius: "50%",
                background: done ? `linear-gradient(135deg,${P},${M})` : active ? `${P}22` : "rgba(255,255,255,0.06)",
                border: active ? `2px solid ${P}` : done ? "none" : "1.5px solid rgba(255,255,255,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.35s",
                boxShadow: active ? `0 0 0 4px ${P}20` : "none",
              }}>
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <span style={{ fontSize: "12px", fontWeight: 700,
                    color: active ? P : "#475569" }}>{s.short}</span>
                )}
              </div>
              <span className="step-label" style={{
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.3px",
                color: active ? "#e2e8f0" : done ? "#64748b" : "#334155",
              }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: "2px", margin: "0 4px",
                background: i < idx ? `linear-gradient(90deg,${P},${M})` : "rgba(255,255,255,0.07)",
                transition: "background 0.4s", position: "relative", top: "-9px",
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}