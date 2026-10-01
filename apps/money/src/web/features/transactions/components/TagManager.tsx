import { type FormEvent, useState } from "react";
import type { Tag } from "../../../../contract";
import { useDeleteTag, useRenameTag } from "../api/transactions";
import { tagOf } from "../utils/split";

const TagRow = ({ tag }: { tag: Tag }) => {
  const rename = useRenameTag();
  const remove = useDeleteTag();
  const [name, setName] = useState(tag.name);
  const to = tagOf(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (to !== null) {
      rename.mutate({ name: tag.name, to });
    }
  };
  const confirmDelete = () => {
    if (tag.items === 0 || window.confirm(`Take "${tag.name}" off ${tag.items} line items and delete it?`)) {
      remove.mutate(tag.name);
    }
  };

  return (
    <li>
      <form className="inline-form" onSubmit={submit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`Rename ${tag.name}`}
          maxLength={40}
        />
        <span className="muted numeric">{tag.items}</span>
        <button type="submit" disabled={to === null || to === tag.name || rename.isPending}>
          Rename
        </button>
        <button type="button" className="danger" onClick={confirmDelete} disabled={remove.isPending}>
          Delete
        </button>
        {(rename.error ?? remove.error) && <span className="error">{(rename.error ?? remove.error)?.message}</span>}
      </form>
    </li>
  );
};

export const TagManager = ({ tags }: { tags: readonly Tag[] }) =>
  tags.length === 0 ? null : (
    <details className="tag-manager">
      <summary>Manage tags</summary>
      <ul>
        {tags.map((tag) => (
          <TagRow key={tag.name} tag={tag} />
        ))}
      </ul>
    </details>
  );
