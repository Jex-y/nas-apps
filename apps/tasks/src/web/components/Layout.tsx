import type { ReactNode } from "react";
import { NavLink } from "./NavLink";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths; on phones the sections sit in a bottom tab bar within thumb reach. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "List", icon: "M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" },
  { href: "/board", label: "Board", icon: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z" },
  { href: "/timeline", label: "Timeline", icon: "M4 6h8M8 12h9M13 18h7M4 3v18" },
];

const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={path} />
  </svg>
);

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
        <a href="/tasks/shell/settings" className="nav-link">
          Settings
        </a>
      </nav>
    </header>
    <main>{children}</main>
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
