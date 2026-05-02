/**
 * src/client/components/StatusBar.tsx — Bottom status bar (24 px tall).
 *
 * WHAT IT DOES:
 *   Shows a compact one-line summary of the active database connection:
 *   dialect | host:port | database | permission mode | connected indicator.
 *
 * WHY IT EXISTS:
 *   The user always needs to know WHICH database they're looking at and in
 *   WHAT permission mode (readonly / write / full). This information must be
 *   visible at all times without occupying panel space.
 *
 * HOW IT WORKS:
 *   useQuery fetches GET /api/status once and caches the result for the
 *   entire browser session (staleTime: Infinity). The component renders from
 *   the query result — no manual fetch, no useEffect, no Zustand sync needed.
 */

import { useQuery } from "@tanstack/react-query";
import type { StatusResponse } from "../stores/app";
import { useThemeStore } from "../stores/theme";

// ===== QUERY =====

/**
 * Fetches /api/status and parses the JSON body.
 * Throws on non-2xx so that React Query can put the query into error state.
 */
async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error(`/api/status returned HTTP ${res.status}`);
  return res.json() as Promise<StatusResponse>;
}

// ===== MAIN COMPONENT =====

/**
 * StatusBar — 24 px fixed-height bar pinned to the bottom of the viewport.
 *
 * WHY useQuery instead of useEffect + fetch:
 *   useQuery gives us loading / error / success states, automatic error retry,
 *   and a shared cache — all for free. If another component in the future needs
 *   the same connection info (e.g. a "Connected to X" header), it can call
 *   useQuery with the same key and get the cached result with zero extra fetches.
 *
 * WHY staleTime: Infinity:
 *   The connection config (dialect, host, port, database, user, mode) is
 *   determined at CLI startup and is immutable for the entire server process
 *   lifetime. There is no mechanism to change it without restarting dbpeek.
 *   staleTime: Infinity tells React Query that once the data is fetched it is
 *   ALWAYS fresh — it will never schedule a background refetch, never refetch
 *   on window focus, and never refetch on component remount. This is the
 *   correct setting for data that physically cannot change during the session.
 *   Using the default staleTime (0) would cause a redundant network request
 *   every time the browser tab is re-focused, for no benefit.
 */
export function StatusBar() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,

    // WHY Infinity: the server's connection config is set once at CLI startup
    // and never changes while the process is running. Treating the cached
    // response as permanently fresh avoids pointless background refetches.
    staleTime: Infinity,

    // Retry once on failure (default is 3). The server is local, so a
    // transient failure is unusual — one retry is sufficient.
    retry: 1,
  });

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    // h-6 = 24px. shrink-0 prevents the status bar from being squished by
    // the flex layout when the center column grows.
    <div className="flex items-center justify-between h-6 px-3 gap-x-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)] font-mono select-none shrink-0 overflow-hidden">
      <div className="flex items-center gap-x-3">
        {isPending && (
          <span className="text-[var(--text-light)] italic">connecting…</span>
        )}
        {isError && (
          <span className="text-red-500 italic">could not reach /api/status</span>
        )}
        {data !== undefined && <ConnectedContent info={data} />}
      </div>
      <button
        onClick={toggleTheme}
        className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer text-[var(--text-secondary)]"
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </div>
  );
}

// ===== SUB-COMPONENTS =====

/**
 * ConnectedContent — renders the dialect / host / db / mode / status items.
 * Extracted so the parent can switch cleanly between loading, error, and
 * loaded states without deeply nested conditionals.
 */
function ConnectedContent({ info }: { info: StatusResponse }) {
  return (
    <>
      <StatusItem label="dialect" value={info.dialect} />
      <Pipe />
      <StatusItem label="host" value={`${info.host}:${info.port}`} />
      <Pipe />
      <StatusItem label="db" value={info.database} />
      <Pipe />
      <StatusItem label="mode" value={info.mode} />
      <Pipe />
      <ConnectionDot connected={info.connected} />
    </>
  );
}

/**
 * StatusItem — a label:value pair in muted / normal text.
 * The label is dimmer than the value to create visual hierarchy.
 */
function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-[var(--text-light)]">{label}</span>
      <span className="text-[var(--text-secondary)]">{value}</span>
    </span>
  );
}

/** Thin separator between status items. */
function Pipe() {
  return <span className="text-[var(--border-color)] select-none">│</span>;
}

/**
 * ConnectionDot — green filled dot when connected, red hollow dot when not.
 * Uses Unicode circle glyphs so no SVG/icon dependency is needed.
 */
function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 whitespace-nowrap ${
        connected ? "text-green-500" : "text-red-500"
      }`}
    >
      <span aria-hidden="true">{connected ? "●" : "○"}</span>
      <span>{connected ? "connected" : "disconnected"}</span>
    </span>
  );
}
