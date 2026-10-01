import type { ReactNode } from "react";
import { Link, useRoute } from "wouter";

export const NavLink = ({ href, className, children }: { href: string; className: string; children: ReactNode }) => {
  const [active] = useRoute(href);
  return (
    <Link href={href} className={active ? `${className} active` : className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
};
