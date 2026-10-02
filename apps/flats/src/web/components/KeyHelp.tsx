import { Fragment, useEffect, useRef, useState } from "react";
import { type Keymap, mountedKeymaps, useKeymap } from "../hooks/useKeymap";

const NAMES: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  "shift+Space": "Shift Space",
};

const nameOf = (stroke: string) => NAMES[stroke] ?? stroke.replace("ctrl+", "Ctrl ");

const Keys = ({ keys }: { keys: readonly string[] }) =>
  keys.map((sequence, at) => (
    <Fragment key={sequence}>
      {at > 0 && " / "}
      {sequence.split(" ").map((stroke, position) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a sequence can repeat a key, as in "g g"
        <Fragment key={position}>
          {position > 0 && " "}
          <kbd>{nameOf(stroke)}</kbd>
        </Fragment>
      ))}
    </Fragment>
  ));

const Shown = ({ keymaps, onClose }: { keymaps: readonly Keymap[]; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  useKeymap("Keys", [{ keys: ["?", "q"], does: "Close", run: () => dialog.current?.close() }], dialog);

  return (
    <dialog ref={dialog} className="key-help" aria-label="Keyboard shortcuts" onClose={onClose}>
      {keymaps
        .filter(({ bindings }) => bindings.length > 0)
        .map(({ title, bindings }) => (
          <section key={title}>
            <h2>{title}</h2>
            <dl>
              {bindings.map(({ keys, does }) => (
                <div key={keys.join()}>
                  <dt>
                    <Keys keys={keys} />
                  </dt>
                  <dd>{does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
    </dialog>
  );
};

/** Lists what the keyboard does on the page in view, on `?`. */
export const KeyHelp = () => {
  const [keymaps, setKeymaps] = useState<readonly Keymap[] | null>(null);
  useKeymap("Help", [{ keys: ["?"], does: "Show these keys", run: () => setKeymaps(mountedKeymaps()) }]);
  return keymaps === null ? null : <Shown keymaps={keymaps} onClose={() => setKeymaps(null)} />;
};
