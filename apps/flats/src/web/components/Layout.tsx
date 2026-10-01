import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useAddListing } from "../features/properties/api/properties";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths. */
const ICONS = {
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z",
  swipe: "M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 10l-2 2 2 2M15 10l2 2-2 2",
  board: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z",
  rejected: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6",
  more: "M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
} as const;

/** On phones the first four sit in the bottom tab bar and the rest in its More menu. */
const TABS: readonly Section[] = [
  { href: "/", label: "Inbox", icon: ICONS.inbox },
  { href: "/swipe", label: "Swipe", icon: ICONS.swipe },
  { href: "/board", label: "Board", icon: ICONS.board },
  { href: "/rejected", label: "Rejected", icon: ICONS.rejected },
];
const MORE: readonly Omit<Section, "icon">[] = [
  { href: "/map", label: "Map" },
  { href: "/searches", label: "Searches" },
  { href: "/commutes", label: "Commutes" },
  { href: "/requirements", label: "Requirements" },
];

/** Served by the app shell, outside the router: theme and notifications. */
const SETTINGS_HREF = "/flats/shell/settings";

const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={path} />
  </svg>
);

const NavLink = ({
  href,
  className,
  onClick,
  children,
}: {
  href: string;
  className: string;
  onClick?: () => void;
  children: ReactNode;
}) => {
  const [active] = useRoute(href);
  return (
    <Link
      href={href}
      className={active ? `${className} active` : className}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </Link>
  );
};

const AddListingForm = () => {
  const addListing = useAddListing();
  const [url, setUrl] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    addListing.mutate(url, { onSuccess: () => setUrl("") });
  };

  return (
    <form className="add-listing" onSubmit={submit}>
      <input
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Paste a Rightmove listing URL"
        aria-label="Listing URL"
        required
      />
      <button type="submit" disabled={addListing.isPending}>
        Add
      </button>
      {addListing.isSuccess && <span className="muted">Added; it appears once fetched.</span>}
      {addListing.error && <span className="error">{addListing.error.message}</span>}
    </form>
  );
};

const TabBar = () => {
  const [location] = useLocation();
  const menu = useRef<HTMLDivElement>(null);
  const inMore = MORE.some(({ href }) => href === location);

  return (
    <nav className="tab-bar" aria-label="Sections">
      {TABS.map(({ href, label, icon }) => (
        <NavLink key={href} href={href} className="tab">
          <Icon path={icon} />
          {label}
        </NavLink>
      ))}
      <button type="button" className={inMore ? "tab active" : "tab"} popoverTarget="more-sections">
        <Icon path={ICONS.more} />
        More
      </button>
      <div id="more-sections" ref={menu} popover="auto" className="more-menu">
        {MORE.map(({ href, label }) => (
          <NavLink key={href} href={href} className="more-link" onClick={() => menu.current?.hidePopover()}>
            {label}
          </NavLink>
        ))}
        <a href={SETTINGS_HREF} className="more-link">
          Settings
        </a>
      </div>
    </nav>
  );
};

export const Layout = ({ children }: { children: ReactNode }) => (
  <>
    <header className="site-header">
      <nav>
        <a href="/" className="nav-link launcher-link">
          ‹ Apps
        </a>
        {[...TABS, ...MORE].map(({ href, label }) => (
          <NavLink key={href} href={href} className="nav-link section-link">
            {label}
          </NavLink>
        ))}
        <a href={SETTINGS_HREF} className="nav-link section-link">
          Settings
        </a>
      </nav>
      <AddListingForm />
    </header>
    <main>{children}</main>
    <TabBar />
  </>
);
