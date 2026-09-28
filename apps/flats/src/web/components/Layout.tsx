import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useRoute } from "wouter";
import { useAddListing } from "../features/properties/api/properties";

const NavLink = ({ href, children }: { href: string; children: ReactNode }) => {
  const [active] = useRoute(href);
  return (
    <Link href={href} className={active ? "nav-link active" : "nav-link"}>
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

export const Layout = ({ children }: { children: ReactNode }) => (
  <>
    <header className="site-header">
      <nav>
        <NavLink href="/">Inbox</NavLink>
        <NavLink href="/swipe">Swipe</NavLink>
        <NavLink href="/board">Board</NavLink>
        <NavLink href="/rejected">Rejected</NavLink>
        <NavLink href="/searches">Searches</NavLink>
        <NavLink href="/commutes">Commutes</NavLink>
      </nav>
      <AddListingForm />
    </header>
    <main>{children}</main>
  </>
);
