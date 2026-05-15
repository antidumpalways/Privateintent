import type React from "react";

interface ChipProps {
  text: string;
  color: string;
  style?: React.CSSProperties;
}

export function Chip({ text, color, style }: ChipProps) {
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, letterSpacing: "0.4px",
      background: `${color}1a`, color, border: `1px solid ${color}35`,
      borderRadius: "999px", padding: "2px 9px", ...style,
    }}>
      {text}
    </span>
  );
}