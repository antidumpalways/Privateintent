import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

interface WalletContextType {
  phantomPubkey: string;      // Solana pubkey (base58)
  phantomEthAddress: string;  // Ethereum address dari Phantom (via window.ethereum)
  connected: boolean;
  connecting: boolean;
  connectPhantom: () => Promise<void>;
  disconnectPhantom: () => void;
  dwalletId: string | null;
  setDwalletId: (id: string | null) => void;
  dwalletAddresses: Record<string, string>;
  setDwalletAddresses: (addrs: Record<string, string>) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const LS_SOL_PUBKEY  = "pi_phantom_pubkey";
const LS_ETH_ADDR    = "pi_phantom_eth_address";
const LS_DWID        = "pi_dwallet_id";
const LS_DWADDRS     = "pi_dwallet_addresses";

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
      disconnect: () => Promise<void>;
      signMessage: (message: Uint8Array, encoding: "utf8") => Promise<{ signature: Uint8Array }>;
      signTransaction: (tx: any) => Promise<{ serialize(): Uint8Array }>;
      publicKey?: { toString(): string };
    };
    ethereum?: {
      isPhantom?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
    };
  }
}

function lsGet(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}
function lsDel(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

async function fetchPhantomEthAddress(): Promise<string> {
  try {
    if (!window.ethereum) return "";
    // eth_accounts does NOT show popup — returns already-connected accounts
    const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts && accounts.length > 0) return accounts[0];
  } catch {}
  return "";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [phantomPubkey, setPhantomPubkey] = useState(() => lsGet(LS_SOL_PUBKEY));
  const [phantomEthAddress, setPhantomEthAddress] = useState(() => lsGet(LS_ETH_ADDR));
  const [connected, setConnected]         = useState(() => !!lsGet(LS_SOL_PUBKEY));
  const [connecting, setConnecting]       = useState(false);
  const [dwalletId, _setDwalletId]        = useState<string | null>(() => lsGet(LS_DWID) || null);
  const [dwalletAddresses, _setDwalletAddresses] = useState<Record<string, string>>(() => {
    try { return JSON.parse(lsGet(LS_DWADDRS) || "{}"); } catch { return {}; }
  });

  const setDwalletId = useCallback((id: string | null) => {
    _setDwalletId(id);
    if (id) lsSet(LS_DWID, id); else lsDel(LS_DWID);
  }, []);

  const setDwalletAddresses = useCallback((addrs: Record<string, string>) => {
    _setDwalletAddresses(addrs);
    try { lsSet(LS_DWADDRS, JSON.stringify(addrs)); } catch {}
  }, []);

  // Helper: read ETH address from window.ethereum and persist
  const refreshEthAddress = useCallback(async () => {
    const eth = await fetchPhantomEthAddress();
    if (eth) {
      setPhantomEthAddress(eth);
      lsSet(LS_ETH_ADDR, eth);
    }
  }, []);

  // Silent auto-connect on mount
  useEffect(() => {
    const tryEager = async () => {
      try {
        if (!window.solana?.isPhantom) return;
        const resp = await window.solana.connect({ onlyIfTrusted: true });
        const pubkey = resp.publicKey.toString();
        setPhantomPubkey(pubkey);
        setConnected(true);
        lsSet(LS_SOL_PUBKEY, pubkey);
        // Also grab ETH address silently
        await refreshEthAddress();
      } catch {
        // Not previously approved — wait for user click
      }
    };
    const t = setTimeout(tryEager, 350);
    return () => clearTimeout(t);
  }, [refreshEthAddress]);

  // If we have a cached ETH address but no current one, try to refresh
  useEffect(() => {
    if (phantomEthAddress) return; // already have it
    if (!phantomPubkey) return;    // not connected yet
    const t = setTimeout(refreshEthAddress, 600);
    return () => clearTimeout(t);
  }, [phantomPubkey, phantomEthAddress, refreshEthAddress]);

  const connectPhantom = useCallback(async () => {
    if (connecting || connected) return;
    setConnecting(true);
    try {
      if (!window.solana?.isPhantom) {
        window.open("https://phantom.app/", "_blank");
        throw new Error("Phantom wallet not found. Please install it and refresh.");
      }

      // Connect Solana
      const resp = await window.solana.connect();
      const pubkey = resp.publicKey.toString();

      // If switching wallets, clear dWallet data
      if (phantomPubkey && pubkey !== phantomPubkey) {
        setDwalletId(null);
        setDwalletAddresses({});
        setPhantomEthAddress("");
        lsDel(LS_ETH_ADDR);
      }

      setPhantomPubkey(pubkey);
      setConnected(true);
      lsSet(LS_SOL_PUBKEY, pubkey);

      // Read ETH address from window.ethereum (Phantom injects this)
      // eth_accounts = silent (no popup), eth_requestAccounts = with popup
      // We try silent first; if empty, request with popup alongside Solana connect
      let ethAddr = await fetchPhantomEthAddress();
      if (!ethAddr && window.ethereum) {
        try {
          const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
          ethAddr = accounts?.[0] ?? "";
        } catch {}
      }
      if (ethAddr) {
        setPhantomEthAddress(ethAddr);
        lsSet(LS_ETH_ADDR, ethAddr);
      }
    } finally {
      setConnecting(false);
    }
  }, [connecting, connected, phantomPubkey, setDwalletId, setDwalletAddresses]);

  const disconnectPhantom = useCallback(() => {
    window.solana?.disconnect().catch(() => {});
    setPhantomPubkey("");
    setPhantomEthAddress("");
    setConnected(false);
    setDwalletId(null);
    setDwalletAddresses({});
    lsDel(LS_SOL_PUBKEY);
    lsDel(LS_ETH_ADDR);
    lsDel(LS_DWID);
    lsDel(LS_DWADDRS);
  }, [setDwalletId, setDwalletAddresses]);

  return (
    <WalletContext.Provider value={{
      phantomPubkey,
      phantomEthAddress,
      connected,
      connecting,
      connectPhantom,
      disconnectPhantom,
      dwalletId,
      setDwalletId,
      dwalletAddresses,
      setDwalletAddresses,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
