import { type KeyboardEvent, useId, useState } from "react";
import { tagOf } from "../utils/split";

type Props = {
  readonly tags: readonly string[];
  readonly onChange: (tags: readonly string[]) => void;
  /** Every tag already in use, offered as the next one is typed. */
  readonly known: readonly string[];
  readonly label: string;
};

/** Tags as removable chips, with a box that adds one on Enter or a comma. */
export const TagInput = ({ tags, onChange, known, label }: Props) => {
  const [text, setText] = useState("");
  const listId = useId();

  const add = (typed: string) => {
    const tag = tagOf(typed);
    if (tag !== null && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "") {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="tag-input">
      {tags.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((other) => other !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(event) =>
          known.includes(event.target.value) ? add(event.target.value) : setText(event.target.value)
        }
        onKeyDown={onKeyDown}
        onBlur={() => add(text)}
        list={listId}
        placeholder={tags.length === 0 ? "Add a tag" : ""}
        aria-label={label}
        maxLength={40}
      />
      <datalist id={listId}>
        {known
          .filter((tag) => !tags.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
};
