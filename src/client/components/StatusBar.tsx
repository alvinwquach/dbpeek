/**
 * src/client/components/StatusBar.tsx
 *
 * WHAT: A 26px-tall status bar fixed to the bottom of the app that shows live
 * database connection info fetched from GET /api/status.
 *
 * WHY: Users need to know at a glance which database they are connected to,
 * what permission mode is active, and whether the connection is healthy —
 * without opening any settings panel.
 *
 * HOW: Imported and rendered by src/client/App.tsx. Reads connectionInfo from
 * the global Zustand store (src/client/stores/app.ts) — no props required.
 */

import { useAppStore } from '../stores/app';
import type { ConnectionInfo } from '../stores/app';

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * StatusItem
 *
 * Renders a single labelled value in the status bar (e.g. "host: localhost").
 *
 * @param label - short label shown in muted colour before the value
 * @param value - the value to display
 * @returns a <span> with label + value
 * @example
 *   <StatusItem label="host" value="localhost" />
 */
function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span className="text-muted">{label}</span>
      <span className="text-primary">{value}</span>
    </span>
  );
}

/**
 * Separator
 *
 * A thin vertical bar between status items.
 *
 * @returns a <span> rendering a centred vertical divider
 * @example
 *   <Separator />
 */
function Separator() {
  return (
    <span className="text-[11px] text-border select-none">│</span>
  );
}

/**
 * ConnectionDot
 *
 * A small coloured circle that communicates connection status at a glance.
 * Green = connected, red = disconnected / API unreachable.
 *
 * @param connected - true if the last /api/status call showed connected: true
 * @returns a <span> containing a coloured dot and a status label
 * @example
 *   <ConnectionDot connected={true} />
 */
function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span
        className={[
          'inline-block w-1.5 h-1.5 rounded-full',
          connected ? 'bg-success animate-pulse' : 'bg-danger',
        ].join(' ')}
      />
      <span className={connected ? 'text-success' : 'text-danger'}>
        {connected ? 'connected' : 'disconnected'}
      </span>
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * formatHostPort
 *
 * Combines host and port into a display string, omitting the port when it
 * matches the well-known default for the dialect.
 *
 * @param info - the ConnectionInfo object from the store
 * @returns a formatted "host:port" string, or just "host" when port is default
 * @example
 *   formatHostPort({ dialect: 'postgres', host: 'localhost', port: 5432 })
 *   // → 'localhost'   (5432 is the default postgres port — omitted)
 */
function formatHostPort(info: ConnectionInfo): string | null {
  if (!info.host) return null;

  const DEFAULTS: Record<string, number> = {
    postgres: 5432,
    mysql: 3306,
    mssql: 1433,
  };

  const showPort = info.port !== undefined && info.port !== DEFAULTS[info.dialect];
  return showPort ? `${info.host}:${info.port}` : info.host;
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * StatusBar
 *
 * Fixed 26px bar at the bottom of the application showing connection details.
 * Renders a loading placeholder until connectionInfo is fetched.
 *
 * @returns the status bar element
 * @example
 *   <StatusBar />
 */
export function StatusBar() {
  const connectionInfo = useAppStore((s) => s.connectionInfo);

  const barClass = 'h-[26px] flex items-center gap-2.5 px-3 shrink-0 bg-surface border-t border-border overflow-hidden whitespace-nowrap';

  if (!connectionInfo) {
    return (
      <div className={barClass}>
        <span className="text-[11px] text-muted">connecting…</span>
      </div>
    );
  }

  const hostPort = formatHostPort(connectionInfo);

  return (
    <div className={barClass}>
      <ConnectionDot connected={connectionInfo.connected} />
      <Separator />
      <StatusItem label="dialect" value={connectionInfo.dialect} />
      {hostPort && (
        <>
          <Separator />
          <StatusItem label="host" value={hostPort} />
        </>
      )}
      {connectionInfo.database && (
        <>
          <Separator />
          <StatusItem label="db" value={connectionInfo.database} />
        </>
      )}
      {connectionInfo.user && (
        <>
          <Separator />
          <StatusItem label="user" value={connectionInfo.user} />
        </>
      )}
      <Separator />
      <StatusItem label="mode" value={connectionInfo.mode} />
    </div>
  );
}
