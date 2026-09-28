import type { ReactNode } from "react";
import { Link, useRoute } from "wouter";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths; on phones the sections sit in a bottom tab bar within thumb reach. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "Pet", icon: "M12 20c-4 0-7-2.5-7-6.5S8 5 12 5s7 4.5 7 8.5-3 6.5-7 6.5zM9.5 12v1M14.5 12v1" },
  { href: "/history", label: "History", icon: "M4 20V10M9.5 20V6M15 20v-8M20.5 20V4" },
  { href: "/health", label: "Health", icon: "M3 12h4l2-5 4 10 2-5h6" },
  {
    href: "/settings",
    label: "Settings",
    icon: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  },
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
