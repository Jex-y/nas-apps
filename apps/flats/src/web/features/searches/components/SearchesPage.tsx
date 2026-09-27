import { type FormEvent, useState } from "react";
import type { Search } from "../../../../contract";
import { formatDateTime } from "../../../utils/format";
import { useCreateSearch, useDeleteSearch, useSearches, useToggleSearch } from "../api/searches";

const SearchForm = () => {
  const createSearch = useCreateSearch();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createSearch.mutate(
      { name, url },
      {
        onSuccess: () => {
          setName("");
          setUrl("");
        },
      },
    );
  };

  return (
    <form className="search-form" onSubmit={submit}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name, e.g. Hackney 2 bed"
        required
      />
      <input
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Rightmove search results URL"
        required
      />
      <button type="submit" disabled={createSearch.isPending}>
        Save search
      </button>
      {createSearch.error && <p className="error">{createSearch.error.message}</p>}
    </form>
  );
};

const SearchHealth = ({ search }: { search: Search }) => {
  if (search.lastError !== null) {
    return (
      <span className="error">
        {search.enabled ? `Failing (${search.consecutiveFailures})` : "Paused after failures"}: {search.lastError}
      </span>
    );
  }
  return (
    <span className="muted">
      {search.lastSucceededAt === null ? "Not polled yet" : `Last polled ${formatDateTime(search.lastSucceededAt)}`}
    </span>
  );
};

export const SearchesPage = () => {
  const searches = useSearches();
  const toggle = useToggleSearch();
  const remove = useDeleteSearch();

  return (
    <section>
      <h1>Searches</h1>
      <p className="muted">
        Set up the search on Rightmove, then paste the results page URL. New listings are picked up every ten minutes
        between 07:00 and 23:00.
      </p>
      <SearchForm />
      {searches.error && <p className="error">{searches.error.message}</p>}
      <ul className="searches">
        {searches.data?.map((search) => (
          <li key={search.id}>
            <div>
              <a href={search.url} target="_blank" rel="noreferrer">
                <strong>{search.name}</strong>
              </a>{" "}
              <span className="muted">{search.portal}</span>
            </div>
            <SearchHealth search={search} />
            <div className="card-actions">
              <button type="button" onClick={() => toggle.mutate({ id: search.id, enabled: !search.enabled })}>
                {search.enabled ? "Pause" : "Resume"}
              </button>
              <button type="button" onClick={() => remove.mutate(search.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
