import type { ReactNode } from "react";
import { Link, useRoute } from "wouter";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths. */
const ICONS = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  stats: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  suggest: "M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 7v6M9 10h6",
  runs: "M13 4a2 2 0 1 0 0 .01M9 20l3-6 3 3v4M7 12l3-4 4 1 3 3M6 20l3-6",
  connect: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
} as const;

/** Five sections, so on phones they all fit the bottom tab bar. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "Map", icon: ICONS.map },
  { href: "/stats", label: "Stats", icon: ICONS.stats },
  { href: "/suggest", label: "Suggest", icon: ICONS.suggest },
  { href: "/activities", label: "Runs", icon: ICONS.runs },
  { href: "/connect", label: "Connect", icon: ICONS.connect },
];

const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={path} />
  </svg>
);

const NavLink = ({ href, className, children }: { href: string; className: string; children: ReactNode }) => {
  const [active] = useRoute(href);
  return (
    <Link href={href} className={active ? `${className} active` : className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
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
        <a href="/streets/shell/settings" className="nav-link">
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
