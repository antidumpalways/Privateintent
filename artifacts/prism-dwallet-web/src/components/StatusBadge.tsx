import { P, M, STATUS_COLORS } from "../lib/constants";

interface StatusBadgeProps {
  status: string;
  pulse?: boolean;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const c = STATUS_COLORS[status] ?? "#64748b";
  const pulse = ["bidding", "executing", "accepted"].includes(status);
  const dotSize = size === "sm" ? 6 : 8;
  const fontSize = size === "sm" ? 11 : 13;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span style={{
        width: `${dotSize}px`, height: `${dotSize}px`, borderRadius: "50%",
        background: c, boxShadow: `0 0 6px ${c}`, display: "inline-block",
        animation: pulse ? "pulse 1.5s infinite" : "none",
      }} />
      <span style={{
        color: c, fontWeight: 600, fontSize: `${fontSize}px`,
        textTransform: "capitalize",
      }}>
        {status}
      </span>
    </span>
  );
}