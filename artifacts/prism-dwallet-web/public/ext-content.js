(function () {
  "use strict";

  if (window.__sentinelWalletInjected) return;
  window.__sentinelWalletInjected = true;

  // Show overlay for medium+ risk (score >= 40); auto-block at 70
  const OVERLAY_THRESHOLD = 40;
  const BLOCK_THRESHOLD = 70;

  function injectScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.setAttribute("data-sentinel", "true");
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  injectScript();

  function respondToInjected(requestId, approved, reason) {
    window.postMessage({
      source: "sentinel-content",
      requestId,
      approved,
      reason,
    }, "*");
  }

  function buildAssetChangesHtml(simulation) {
    if (!simulation || !simulation.assetChanges || simulation.assetChanges.length === 0) return "";
    const rows = simulation.assetChanges.map((change) => {
      const dir = change.direction === "out" ? "−" : "+";
      const dirColor = change.direction === "out" ? "#ef4444" : "#22c55e";
      const amount = change.amount != null ? change.amount : "";
      const symbol = change.symbol || "";
      const addr = change.address
        ? change.address.slice(0, 5) + "…" + change.address.slice(-4)
        : "";
      const riskyBadge = change.isRisky
        ? `<span style="background:#ef444420;color:#ef4444;border:1px solid #ef444440;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:5px">⚠ risky</span>`
        : "";
      const addrPart = addr
        ? `<span style="color:#64748b;font-size:9px;font-family:monospace;margin-left:4px">${addr}${riskyBadge}</span>`
        : "";
      return `
        <div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #1e293b">
          <span style="font-size:13px;font-weight:700;color:${dirColor};min-width:12px">${dir}</span>
          <span style="font-size:12px;font-weight:600;color:#f1f5f9">${amount} ${symbol}</span>
          ${addrPart}
        </div>
      `;
    }).join("");

    return `
      <div style="background:#141821;border-radius:8px;padding:12px;margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;color:#9945ff;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">◈ Transaction Preview</div>
        ${rows}
      </div>
    `;
  }

  function buildAllowanceChangesHtml(simulation) {
    if (!simulation || !simulation.allowanceChanges || simulation.allowanceChanges.length === 0) return "";

    const UNLIMITED_THRESHOLD = 1e15;

    function isUnlimited(amount) {
      if (typeof amount === "string") {
        const lower = amount.toLowerCase();
        if (lower === "unlimited" || lower === "max" || lower === "∞" || lower === "infinite") return true;
        const num = parseFloat(amount);
        if (!isNaN(num) && num >= UNLIMITED_THRESHOLD) return true;
      }
      if (typeof amount === "number" && amount >= UNLIMITED_THRESHOLD) return true;
      return false;
    }

    const rows = simulation.allowanceChanges.map((change) => {
      const spender = change.spender || "";
      const shortSpender = spender.length > 10
        ? spender.slice(0, 6) + "…" + spender.slice(-4)
        : spender;
      const token = change.token || "Unknown";
      const amount = change.amount != null ? String(change.amount) : "";
      const risky = isUnlimited(change.amount);

      const riskBadge = risky
        ? `<span style="background:#ef444420;color:#ef4444;border:1px solid #ef444440;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:5px">⚠ large/unlimited</span>`
        : "";

      const amountDisplay = isUnlimited(change.amount) ? "Unlimited" : amount;
      const amountColor = risky ? "#ef4444" : "#f59715";

      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <span style="font-size:11px;font-weight:600;color:#f1f5f9">${token}</span>
            <span style="font-size:9px;font-family:monospace;color:#64748b">${shortSpender}${riskBadge}</span>
          </div>
          <span style="font-size:11px;font-weight:700;color:${amountColor};white-space:nowrap;margin-left:8px">${amountDisplay}</span>
        </div>
      `;
    }).join("");

    return `
      <div style="background:#141821;border-radius:8px;padding:12px;margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;color:#f59715;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">⚑ Approvals</div>
        ${rows}
      </div>
    `;
  }

  function buildRiskDetailsHtml(simulation, flags) {
    const details = simulation?.riskDetails || [];

    if (details.length === 0 && flags.length === 0) return "";

    if (details.length > 0) {
      const bullets = details.map((d) =>
        `<div style="display:flex;align-items:flex-start;gap:6px;font-size:11px;color:#fbbf24;margin-bottom:5px">
          <span style="flex-shrink:0;margin-top:1px">•</span>
          <span style="line-height:1.4">${d}</span>
        </div>`
      ).join("");
      return `<div style="margin-bottom:12px">${bullets}</div>`;
    }

    // Fallback to legacy flags
    const flagBullets = flags.slice(0, 4).map((f) =>
      `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#f59715;margin-bottom:4px">
        <span>⚠</span><span>${f}</span>
      </div>`
    ).join("");
    return `<div style="margin-bottom:12px">${flagBullets}</div>`;
  }

  function buildForensicHtml(forensicAnalysis) {
    if (!forensicAnalysis) return "";
    return `
      <div style="background:#0f1420;border:1px solid #9945ff30;border-radius:8px;padding:12px 14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:12px">🤖</span>
          <span style="font-size:10px;font-weight:700;color:#a855f7;text-transform:uppercase;letter-spacing:0.8px">AI Forensic Analysis</span>
          <span style="font-size:9px;color:#334155;margin-left:auto">Claude Haiku</span>
        </div>
        <div style="font-size:12px;font-weight:600;color:#f1f5f9;margin-bottom:6px;line-height:1.4">${forensicAnalysis.summary}</div>
        <div style="font-size:11px;color:#94a3b8;line-height:1.5;margin-bottom:6px">${forensicAnalysis.riskExplanation}</div>
        <div style="font-size:11px;color:#fbbf24;line-height:1.4;border-top:1px solid #1e293b;padding-top:6px">💡 ${forensicAnalysis.userAdvice}</div>
      </div>
    `;
  }

  function buildAuthorityBadges(riskData) {
    const badges = [];
    if (riskData?.mintAuthority) {
      badges.push({ label: "Mint Authority", color: "#f59715" });
    }
    if (riskData?.freezeAuthority) {
      badges.push({ label: "Freeze Authority", color: "#ef4444" });
    }
    if (riskData?.closable) {
      badges.push({ label: "Closable", color: "#a855f7" });
    }
    if (badges.length === 0) return "";
    const badgeHtml = badges.map((b) =>
      `<span style="background:${b.color}15;color:${b.color};border:1px solid ${b.color}40;border-radius:4px;padding:2px 7px;font-size:9px;font-weight:700">${b.label}</span>`
    ).join("");
    return `
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">
        ${badgeHtml}
      </div>
    `;
  }

  function createOverlay(requestId, contractAddress, riskData, chain) {
    const existing = document.getElementById("sentinel-overlay");
    if (existing) existing.remove();

    const score = riskData?.score ?? 0;
    const verdict = riskData?.verdict ?? "unknown";
    const flags = riskData?.flags || [];
    const simulation = riskData?.simulation || null;
    const ikaCoSigned = riskData?.ikaCoSigned ?? false;
    const ikaMode = riskData?.ikaMode ?? "checking";
    const onChainRef = riskData?.encryptRef ?? "";
    const isSolana = chain === "solana";
    const isBlocked = score >= BLOCK_THRESHOLD;

    const riskColor = isBlocked ? "#ef4444" : score >= 40 ? "#f59715" : "#22c55e";
    const riskLabel = isBlocked ? "HIGH RISK" : score >= 40 ? "MEDIUM RISK" : "LOW RISK";

    const overlay = document.createElement("div");
    overlay.id = "sentinel-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Transaction Risk Analysis");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    `;

    const borderColor = isSolana
      ? (isBlocked ? "#ef444450" : "#9945ff50")
      : (isBlocked ? "#ef444430" : "#1e293b");

    const card = document.createElement("div");
    card.style.cssText = `
      background: #0f1117;
      border: 1.5px solid ${borderColor};
      border-radius: 14px;
      padding: 0;
      width: 420px;
      max-width: 93vw;
      color: #e2e8f0;
      box-shadow: 0 25px 60px rgba(0,0,0,0.7)${isSolana ? ", 0 0 0 1px #9945ff20" : ""};
      overflow: hidden;
    `;

    const shortAddr = contractAddress
      ? contractAddress.slice(0, 8) + "…" + contractAddress.slice(-6)
      : "Unknown";

    const addrLabel = isSolana ? "Program ID" : "Contract";

    const ikaStatusColor = ikaCoSigned ? "#22c55e" : "#ef4444";
    const ikaStatusText = ikaCoSigned ? "Co-signed" : "Denied";

    const assetChangesHtml = buildAssetChangesHtml(simulation);
    const allowanceChangesHtml = buildAllowanceChangesHtml(simulation);
    const riskDetailsHtml = buildRiskDetailsHtml(simulation, flags);
    const authorityBadgesHtml = buildAuthorityBadges(riskData);
    const forensicHtml = buildForensicHtml(riskData?.forensicAnalysis);

    const blockedBanner = isBlocked ? `
      <div style="background:linear-gradient(90deg,#ef444420,#7f1d1d30);border:1px solid #ef444440;border-radius:8px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">🔒</span>
        <div>
          <div style="font-size:12px;font-weight:700;color:#ef4444;margin-bottom:2px">Blocked by Ika MPC</div>
          <div style="font-size:10px;color:#fca5a5;line-height:1.4">This transaction has been automatically rejected. The risk score exceeds the safe threshold.</div>
        </div>
      </div>
    ` : "";

    // Header bar with Solana branding
    const headerBg = isSolana
      ? "linear-gradient(135deg, #1a0f2e 0%, #0f1117 60%)"
      : "#141821";

    card.innerHTML = `
      <div style="background:${headerBg};padding:16px 20px;border-bottom:1px solid ${isSolana ? "#9945ff25" : "#1e293b"};display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="${isSolana ? "#9945ff30" : "#0ea5e920"}" stroke="${isSolana ? "#9945ff" : "#0ea5e9"}" stroke-width="1.5"/>
            <path d="M9 12l2 2 4-4" stroke="${isSolana ? "#9945ff" : "#0ea5e9"}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <div style="font-weight:700;font-size:14px;color:#f1f5f9">CipherGate</div>
            <div style="font-size:10px;color:#64748b;margin-top:1px">Transaction Risk Analysis</div>
          </div>
        </div>
        ${isSolana
          ? `<div style="display:flex;align-items:center;gap:5px;background:#9945ff20;border:1px solid #9945ff40;border-radius:6px;padding:4px 9px">
               <span style="font-size:13px;color:#9945ff">◎</span>
               <span style="font-size:10px;font-weight:700;color:#9945ff">Solana</span>
             </div>`
          : `<div style="background:#627eea20;color:#627eea;border:1px solid #627eea40;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700">Ξ EVM</div>`
        }
      </div>

      <div style="padding:18px 20px">
        <div style="background:#141821;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:11px;color:#64748b">${addrLabel}</div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8">${shortAddr}</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:32px;font-weight:800;color:${riskColor};letter-spacing:-1px;line-height:1">${score}<span style="font-size:14px;font-weight:400;opacity:0.6">/100</span></div>
              <div style="font-size:11px;font-weight:700;color:${riskColor};letter-spacing:0.8px;margin-top:4px">${riskLabel}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:10px;color:#64748b;margin-bottom:5px">Ika MPC</div>
              <div style="background:${ikaStatusColor}20;color:${ikaStatusColor};border:1px solid ${ikaStatusColor}40;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:600">${ikaStatusText}</div>
              <div style="font-size:9px;color:#334155;margin-top:4px;font-family:monospace">${ikaMode}</div>
            </div>
          </div>
        </div>

        ${onChainRef ? `
          <div style="background:#141821;border-radius:6px;padding:8px 10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;font-size:10px">
            <span style="color:#64748b">Encrypt Ref</span>
            <span style="color:#a855f7;font-family:monospace">${onChainRef.slice(0, 22)}…</span>
          </div>
        ` : ""}

        ${authorityBadgesHtml}
        ${assetChangesHtml}
        ${allowanceChangesHtml}
        ${riskDetailsHtml}
        ${forensicHtml}
        ${blockedBanner}

        <div style="font-size:9px;color:#334155;margin-bottom:14px;text-align:center">
          CipherGate · Ika MPC · Encrypt FHE · GoldRush · Claude AI
        </div>

        <div style="display:flex;gap:8px">
          <button id="sentinel-block" style="
            flex:1;background:#ef444420;color:#ef4444;border:1px solid #ef444440;
            border-radius:8px;padding:10px;font-size:12px;font-weight:600;cursor:pointer;
            transition:background 0.15s;
          ">${isBlocked ? "Dismiss" : "🛡 Block Transaction"}</button>
          ${!isBlocked ? `
            <button id="sentinel-proceed" style="
              flex:1;background:${isSolana ? "#9945ff20" : "#22c55e20"};color:${isSolana ? "#9945ff" : "#22c55e"};border:1px solid ${isSolana ? "#9945ff40" : "#22c55e40"};
              border-radius:8px;padding:10px;font-size:12px;font-weight:600;cursor:pointer;
              transition:background 0.15s;
            ">✓ Proceed Anyway</button>
          ` : ""}
        </div>
      </div>
    `;

    overlay.appendChild(card);
    (document.body || document.documentElement).appendChild(overlay);

    // ── Keyboard accessibility ──────────────────────────
    // Resolve button references now that the card is in the DOM
    const blockBtn   = document.getElementById("sentinel-block");
    const proceedBtn = document.getElementById("sentinel-proceed");

    // Collect the focusable buttons for Tab cycling
    const getFocusable = () => {
      const btns = [];
      if (blockBtn   && document.body.contains(blockBtn))   btns.push(blockBtn);
      if (proceedBtn && document.body.contains(proceedBtn)) btns.push(proceedBtn);
      return btns;
    };

    // Declare onKeyDown before click handlers so all paths can deregister it
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        // Treat Escape the same as Block for medium-risk overlays
        if (!isBlocked && requestId !== null) {
          respondToInjected(requestId, false, `Risk score ${score}/100 — dismissed via Escape`);
        }
        return;
      }

      if (e.key === "Tab") {
        const focusable = getFocusable();
        if (focusable.length === 0) return;
        e.preventDefault();
        const current = document.activeElement;
        const idx = focusable.indexOf(current);
        if (e.shiftKey) {
          const prev = idx <= 0 ? focusable[focusable.length - 1] : focusable[idx - 1];
          prev.focus();
        } else {
          const next = idx === -1 || idx >= focusable.length - 1 ? focusable[0] : focusable[idx + 1];
          next.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    // Auto-focus the first button when the overlay opens
    if (blockBtn) blockBtn.focus();

    // Click handlers — also deregister the keydown listener for tighter cleanup
    if (blockBtn) {
      blockBtn.addEventListener("click", () => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        // For auto-blocked txs (requestId is null), the rejection was already sent
        // before the overlay appeared — this button only dismisses the informational UI.
        if (!isBlocked && requestId !== null) {
          respondToInjected(requestId, false, `Risk score ${score}/100 — ${verdict}`);
        }
      });
    }

    if (proceedBtn) {
      proceedBtn.addEventListener("click", () => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        respondToInjected(requestId, true, "user-approved");
      });
    }

    // Clean up the keyboard listener if the overlay is removed externally
    const observer = new MutationObserver(() => {
      if (!document.getElementById("sentinel-overlay")) {
        document.removeEventListener("keydown", onKeyDown, true);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function analyzeAndDecide(requestId, contractAddress, txType, amountUsd, chain, encodedTx) {
    chrome.runtime.sendMessage(
      { type: "ANALYZE_TX", contractAddress, txType, amountUsd, chain, encodedTx: encodedTx || null },
      (response) => {
        if (chrome.runtime.lastError) {
          respondToInjected(requestId, true, "extension-unavailable");
          return;
        }
        if (!response || response.error) {
          respondToInjected(requestId, true, "analysis-error-passthrough");
          return;
        }

        const score = response.result?.score ?? 0;

        if (score >= BLOCK_THRESHOLD) {
          // Immediately reject — the transaction is already blocked before the overlay shows.
          // The overlay is purely informational; no button controls the outcome.
          respondToInjected(requestId, false, `Auto-blocked: risk score ${score}/100`);
          createOverlay(null, contractAddress, {
            ...response.result,
            ikaMode: response.ikaMode || "devnet",
            encryptRef: response.encryptRef || "",
          }, chain);
        } else if (score >= OVERLAY_THRESHOLD) {
          // Medium risk — show overlay so user can approve or block
          createOverlay(requestId, contractAddress, {
            ...response.result,
            ikaMode: response.ikaMode || "devnet",
            encryptRef: response.encryptRef || "",
          }, chain);
        } else {
          // Low risk (< 40) — completely silent, no friction
          respondToInjected(requestId, true, "low-risk-auto-approved");
        }
      }
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "sentinel-injected") return;

    if (event.data.type === "TX_INTERCEPT") {
      const { requestId, contractAddress, txType, amountUsd } = event.data;
      analyzeAndDecide(requestId, contractAddress, txType, amountUsd || 0, "evm", null);
    }

    if (event.data.type === "SOL_TX_INTERCEPT") {
      const { requestId, contractAddress, txType, amountUsd, encodedTx } = event.data;
      analyzeAndDecide(requestId, contractAddress, txType || "solana_tx", amountUsd || 0, "solana", encodedTx || null);
    }

    if (event.data.type === "CONTRACT_SCAN") {
      const { contractAddress, chain } = event.data;
      chrome.runtime.sendMessage(
        { type: "SCAN_CONTRACT", contractAddress },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (!response || !response.result) return;
          if ((response.result.score || 0) >= OVERLAY_THRESHOLD) {
            createOverlay(-1, contractAddress, response.result, chain || "evm");
          }
        }
      );
    }
  });
})();
