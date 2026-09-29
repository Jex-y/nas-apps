import type { ReactNode } from "react";
import { Link } from "wouter";

export const Layout = ({ children }: { children: ReactNode }) => (
  <>
    <header className="site-header">
      <nav>
        <a href="/" className="nav-link">
          ‹ Apps
        </a>
        <Link href="/" className="nav-link">
          Projects
        </Link>
      </nav>
    </header>
    <main>{children}</main>
  </>
);
