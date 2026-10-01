import type { ReactNode } from "react";
import { useStore } from "../hooks/useStore";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { NavLink } from "./NavLink";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths; on phones the sections sit in a bottom tab bar within thumb reach. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "Log", icon: "M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12" },
  { href: "/history", label: "History", icon: "M5 4h14v16H5zM5 9h14M9 4v5M15 4v5" },
  { href: "/exercises", label: "Exercises", icon: "M4 19h16M7 16v-5M12 16V6M17 16v-8" },
];

const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={path} />
  </svg>
);

/** Says what has not reached the server, what it refused, and when the log cannot outlive the page. */
const SyncNotice = () => {
  const store = useStore();
  const { pending, durability, refusal } = useSyncStatus();

  return (
    <>
      {pending > 0 && (
        <p className="sync-pending" role="status">
          {pending === 1 ? "1 change" : `${pending} changes`} waiting to sync
        </p>
      )}
      {refusal !== null && (
        <p className="notice" role="alert">
          A change was undone: {refusal}
          <button type="button" onClick={store.dismissRefusal}>
            Dismiss
          </button>
        </p>
      )}
      {durability === "none" && (
        <p className="notice">This browser cannot keep the log on the device, so changes need a connection.</p>
      )}
      {durability === "other-tab" && (
        <p className="notice">The log is open in another tab, so changes made in this one need a connection.</p>
      )}
    </>
  );
};

export const Layout = ({ children }: { children: ReactNode }) => (
  <>
    <header className="site-header">
      <nav>
        <a href="/" className="nav-link launcher-link">
          ‹ Apps
        </a>
        {SECTIONS.map(({ href, label }) => (
          <NavLink key={href} href={href} className="nav-link section-link">
            {label}
          </NavLink>
        ))}
        <a href="/lifts/shell/settings" className="nav-link">
          Settings
        </a>
      </nav>
    </header>
    <main>
      <SyncNotice />
      {children}
    </main>
    <nav className="tab-bar" aria-label="Sections">
      {SECTIONS.map(({ href, label, icon }) => (
        <NavLink key={href} href={href} className="tab">
          <Icon path={icon} />
          {label}
        </NavLink>
      ))}
    </nav>
  </>
);
