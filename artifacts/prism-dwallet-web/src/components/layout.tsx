import React from "react";
import { Link, useLocation } from "wouter";
import { Shield, Settings, Activity, ShieldAlert, Briefcase, Bot, FileText, Wallet, Puzzle } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";

const navItems = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/setup", label: "Setup dWallet", icon: Wallet },
  { href: "/policy", label: "Security Policy", icon: Settings },
  { href: "/risk", label: "Risk Scanner", icon: ShieldAlert },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/agent", label: "Agent Mode", icon: Bot },
  { href: "/audit", label: "Audit Logs", icon: FileText },
  { href: "/extension", label: "Extension (Mode A)", icon: Puzzle },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { phantomPubkey: walletAddress } = useWallet();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      <aside className="w-64 border-r border-border bg-card/50 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Shield className="h-6 w-6 text-primary mr-2" />
          <span className="font-bold text-lg tracking-tight">PrismDwallet</span>
        </div>
        
        <div className="p-4 border-b border-border">
          <div className="text-xs text-muted-foreground mb-1">Active Wallet</div>
          <div className="font-mono text-xs bg-muted px-2 py-1.5 rounded truncate" title={walletAddress}>
            {walletAddress || "Not Connected"}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 mr-3" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center">
            <div className="h-2 w-2 rounded-full bg-green-500 mr-2" />
            Ika Network: Online
          </div>
          <div className="flex items-center mt-2">
            <div className="h-2 w-2 rounded-full bg-green-500 mr-2" />
            Encrypt FHE: Online
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-8 max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
