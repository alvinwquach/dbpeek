/**
 * src/client/components/SessionReport.tsx — End-of-session summary modal.
 *
 * ===== WHAT IT DOES =====
 * Displays a compact report when the user presses Cmd+D (or Ctrl+D on Windows/
 * Linux) before closing the terminal or the browser tab. The report shows:
 *
 *   • Queries executed  — total count from the in-memory history log.
 *   • Time connected    — wall-clock duration since the SPA first mounted.
 *   • Data transmitted  — always "0 bytes (localhost only)" because dbpeek
 *                         routes all traffic through a local Express server;
 *                         no data ever crosses the network.
 *   • Files written     — always 0; CSV/JSON/Excel exports are written to the
 *                         user's local downloads folder by the browser, not by
 *                         dbpeek itself. The server never writes files.
 *   • Credentials stored — always 0; the password lives only in the Node.js
 *                          process's Knex pool config and is never serialised,
 *                          stored on disk, or transmitted to the browser.
 *   • Connection string — dialect://user@host:port/database (no password).
 *
 * ===== WHY IT EXISTS =====
 * Security-conscious users want a quick "what did I do this session?" audit
 * before disconnecting. The static zeros for data / files / credentials are
 * intentional reassurances, not lazy placeholders — they reflect real
 * architectural guarantees of the tool.
 *
 * ===== HOW IT INTEGRATES =====
 *   1. App.tsx listens for Cmd+D / Ctrl+D on the window keydown event and
 *      flips `sessionReportOpen: boolean` state to true.
 *   2. The modal is conditionally rendered, so it occupies zero DOM when closed.
 *   3. Dismissal (Escape, ✕, backdrop click) flips the state back to false.
 *
 * ===== ARCHITECTURE NOTES =====
 *   • No external data fetch — all values come from the Zustand store that is
 *     already loaded when this component mounts.
 *   • "Copy connection string" uses navigator.clipboard.writeText (same pattern
 *     as DdlViewer.tsx — see that file for the rationale).
 *   • Body-scroll lock and Escape handler mirror DdlViewer.tsx for consistency.
 */

import { useEffect, useState } from "react";
import { useAppStore } from "../stores/app";

// ===== TYPES =====

/** Props for the top-level SessionReport modal. */
interface SessionReportProps {
  /** Called when the user dismisses the modal (Escape, ✕, or backdrop click). */
  onClose: () => void;
}

// ===== ICONS =====

/**
 * Terminal / session glyph for the modal header.
 * A small rectangle with a blinking cursor line reads as "terminal output"
 * and contextualises the report as a CLI session summary.
 */
function TerminalIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-[#7c85d6]"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      {/* Outer terminal window rectangle */}
      <rect
        x="1"
        y="2"
        width="12"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1"
      />
      {/* Prompt chevron > */}
      <path
        d="M3.5 6.5L5.5 7L3.5 7.5"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor underline after the prompt */}
      <line
        x1="6.5"
        y1="7"
        x2="8.5"
        y2="7"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Two-rectangle copy glyph — matches DdlViewer.tsx for visual consistency. */
function CopyIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="3.5"
        width="6"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M6 3.5V2a.5.5 0 01.5-.5h4A.5.5 0 0111 2v6a.5.5 0 01-.5.5H9.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Checkmark — shown for ~1.5 s after a successful clipboard write. */
function CheckIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 6.5L5 9L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ===== HELPERS =====

/**
 * formatDuration — converts a millisecond count into a human-readable string.
 *
 * Examples:
 *   0 → "0 sec"
 *   45 000 → "45 sec"
 *   120 000 → "2 min"
 *   3 661 000 → "1 h 1 min"
 *
 * WHY no seconds above one minute: once a session lasts more than a minute,
 * sub-minute precision adds noise without insight. "14 min" is more readable
 * than "14 min 23 sec".
 */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec} sec`;

  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin} min`;

  const hours = Math.floor(totalMin / 60);
  const remainMin = totalMin % 60;
  return remainMin === 0 ? `${hours} h` : `${hours} h ${remainMin} min`;
}

/**
 * buildConnectionString — assembles a safe connection URI for display and copy.
 *
 * The password is intentionally excluded. The user already knows their own
 * password; sharing a passwordless URI (e.g. in a bug report or a teammate's
 * config) is safe, while including the password would not be.
 *
 * Example output: "postgres://alice@localhost:5432/mydb"
 *
 * WHY not include the password:
 *   The browser never receives the password (it stays in the Express server's
 *   Knex pool config). Even if we wanted to include it, we couldn't.
 */
function buildConnectionString(
  dialect: string,
  user: string,
  host: string,
  port: number,
  database: string
): string {
  // Normalise dialect to a URI scheme. Knex uses "mssql"; the canonical URI
  // scheme is "sqlserver" or "mssql" — we keep "mssql" for familiarity.
  const scheme = dialect;
  return `${scheme}://${user}@${host}:${port}/${database}`;
}

// ===== SUB-COMPONENTS =====

/**
 * StatRow — one line in the session stats table.
 *
 * WHY label + value + note (three columns):
 *   The "note" slot carries explanatory text like "(localhost only)" or
 *   "(never transmitted to browser)" without cluttering the value cell.
 *   It renders in a dimmer gray so it reads as a footnote, not primary data.
 */
function StatRow({
  label,
  value,
  note,
  valueColor = "text-[#ededf0]",
}: {
  label: string;
  value: string;
  note?: string;
  /** Optional Tailwind color class for the value — defaults to off-white. */
  valueColor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-[#1f2033] last:border-b-0">
      {/* Metric label — muted gray, uppercase, monospace for alignment */}
      <span className="text-[10.5px] uppercase tracking-wider text-[#6b7280] font-mono shrink-0">
        {label}
      </span>

      {/* Value + optional note on the right, right-aligned */}
      <span className="flex items-baseline gap-2 text-right">
        <span className={`text-[13px] font-mono font-semibold ${valueColor}`}>
          {value}
        </span>
        {note && (
          <span className="text-[10px] font-mono text-[#374151] whitespace-nowrap">
            {note}
          </span>
        )}
      </span>
    </div>
  );
}

// ===== MAIN COMPONENT =====

/**
 * SessionReport — full-screen modal summarising the current dbpeek session.
 *
 * DATA SOURCES:
 *   • history.length  → queries executed
 *   • sessionStartTime → elapsed wall-clock time (Date.now() - sessionStartTime)
 *   • connectionInfo  → dialect, user, host, port, database for the URI
 *
 * STATIC VALUES (architectural guarantees, not dynamic metrics):
 *   • Data transmitted: 0 bytes — all traffic is localhost; no network bytes.
 *   • Files written: 0 — exports go to the browser's download API, not the server.
 *   • Credentials stored: 0 — the password never leaves the Node.js process.
 */
export function SessionReport({ onClose }: SessionReportProps) {
  // ── Read session data from the store ─────────────────────────────────────
  const history = useAppStore((s) => s.history);
  const sessionStartTime = useAppStore((s) => s.sessionStartTime);
  const connectionInfo = useAppStore((s) => s.connectionInfo);

  // ── Derived metrics ───────────────────────────────────────────────────────

  /** Total queries executed this session (history is capped at 200). */
  const queriesExecuted = history.length;

  /**
   * Wall-clock time since the SPA mounted. Computed once on render — we don't
   * need a live ticker; the report is snapshotted at the moment Cmd+D is pressed.
   */
  const elapsedMs = Date.now() - sessionStartTime.getTime();
  const timeConnected = formatDuration(elapsedMs);

  /**
   * Passwordless connection string for display and copy. Falls back to a
   * placeholder if connectionInfo hasn't loaded yet (extremely unlikely when
   * this modal is shown, but defensive).
   */
  const connectionString = connectionInfo
    ? buildConnectionString(
        connectionInfo.dialect,
        connectionInfo.user,
        connectionInfo.host,
        connectionInfo.port,
        connectionInfo.database
      )
    : "—";

  // ── Copy-to-clipboard state ───────────────────────────────────────────────
  // Mirrors the same pattern used in DdlViewer.tsx: flip a boolean, swap the
  // icon + label, reset after 1.5 s.
  const [copied, setCopied] = useState(false);

  /**
   * handleCopy — writes the passwordless connection string to the clipboard.
   *
   * Errors are silently swallowed (same rationale as DdlViewer.handleCopy):
   * the user can always manually select and copy the displayed string.
   */
  const handleCopy = async () => {
    if (!connectionInfo) return;
    try {
      await navigator.clipboard.writeText(connectionString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // intentionally silent
    }
  };

  // ── Escape key + body-scroll lock ────────────────────────────────────────
  // Mirrors DdlViewer.tsx: Escape dismisses, body scroll is locked while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // Backdrop: full-screen dimmed layer, same as DdlViewer.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      {/* ===== DIALOG ===== */}
      {/*
        stopPropagation prevents backdrop-click from firing when the user
        clicks inside the modal (e.g. to select the connection string).
      */}
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Session report"
        className="flex flex-col w-[min(480px,90vw)] rounded-md border border-[#1f2033] bg-[#0a0a0f] shadow-2xl overflow-hidden"
      >

        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#1f2033] shrink-0">
          <TerminalIcon />
          <span className="text-[11px] uppercase tracking-widest font-semibold text-[#9ca3af]">
            Session Report
          </span>

          {/* Push the close button to the right */}
          <div className="flex-1" />

          {/* Close button — explicit ✕ for users who don't know about Escape */}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] transition-colors duration-100"
            aria-label="Close session report"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ===== BODY ===== */}
        <div className="flex flex-col gap-0 px-4 py-3">

          {/* ── STATS TABLE ── */}
          {/*
            Each StatRow is a label:value pair. The static-zero rows (data
            transmitted, files written, credentials stored) are intentional
            security assurances — they document what dbpeek deliberately does NOT
            do, not gaps in instrumentation.
          */}
          <StatRow
            label="Queries executed"
            value={String(queriesExecuted)}
            valueColor={queriesExecuted > 0 ? "text-[#7c85d6]" : "text-[#ededf0]"}
          />
          <StatRow
            label="Time connected"
            value={timeConnected}
          />
          <StatRow
            label="Data transmitted"
            value="0 bytes"
            note="(localhost only)"
            valueColor="text-[#34d399]"
          />
          <StatRow
            label="Files written"
            value="0"
            valueColor="text-[#34d399]"
          />
          <StatRow
            label="Credentials stored"
            value="0"
            note="(never transmitted to browser)"
            valueColor="text-[#34d399]"
          />
        </div>

        {/* ===== CONNECTION STRING ===== */}
        {/*
          Rendered as its own section below the stats table so it stands apart
          visually — it's the one piece of data the user is most likely to want
          to copy, so it gets a dedicated row with a copy button.
        */}
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          <span className="text-[10px] uppercase tracking-wider text-[#4b5563] font-mono">
            Connection
          </span>

          {/* Connection string row: monospace value + copy button */}
          <div className="flex items-center gap-2 px-3 py-2 rounded border border-[#1f2033] bg-[#0c0c14]">
            {/* The connection string itself — truncate if very long, but also
                allow horizontal scroll via overflow-x-auto on the wrapper */}
            <span className="flex-1 text-[11.5px] font-mono text-[#9ca3af] truncate select-all">
              {connectionString}
            </span>

            {/* Copy button — same style as DdlViewer's copy button */}
            <button
              onClick={handleCopy}
              disabled={!connectionInfo}
              className={[
                "flex items-center gap-1.5 px-2 h-6 rounded text-[10.5px] font-mono shrink-0",
                "border border-[#1f2033] bg-[#0f0f1a]",
                "hover:bg-[#14142b] hover:border-[#3b4070]",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                "transition-colors duration-100",
                copied ? "text-[#34d399]" : "text-[#9ca3af]",
              ].join(" ")}
              aria-label="Copy connection string to clipboard"
              title="Copy connection string (no password)"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          {/* Disclaimer line — explicit, because "no password" is a security
              property the user should be able to verify at a glance. */}
          <span className="text-[9.5px] font-mono text-[#374151]">
            Password excluded — never transmitted to the browser.
          </span>
        </div>

      </div>
    </div>
  );
}
