import type { ReactNode } from "react";
import { NavLink } from "./NavLink";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths; on phones the sections sit in a bottom tab bar within thumb reach. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "Worth", icon: "M4 19h16M5 15l4-5 4 3 6-8" },
  { href: "/transactions", label: "Transactions", icon: "M4 7h13l-3-3M20 17H7l3 3" },
  { href: "/spending", label: "Spending", icon: "M5 20V10M12 20V4M19 20v-7" },
  { href: "/holdings", label: "Holdings", icon: "M12 3v9h9A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z" },
  { href: "/accounts", label: "Accounts", icon: "M3 10l9-6 9 6M5 10v9M19 10v9M9 13v6M15 13v6M3 20h18" },
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
        <a href="/" className="nav-link">
          ‹ Apps
        </a>
        {SECTIONS.map(({ href, label }) => (
          <NavLink key={href} href={href} className="nav-link section-link">
            {label}
          </NavLink>
        ))}
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
