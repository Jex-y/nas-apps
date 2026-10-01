import { type ReactNode, useEffect, useState } from "react";

/** How long the second tap is waited for before the button goes back to what it was. */
const ARMED_MS = 3000;

type Props = {
  readonly className?: string;
  /** What the button says once tapped, asking for the tap that does it. */
  readonly confirm: string;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
};

/** Acts on the second tap, so nothing is destroyed by a stray one and no dialog is put in the way. */
export const ConfirmButton = ({ className, confirm, onConfirm, children }: Props) => {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) {
      return;
    }
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={[className, armed ? "danger" : ""].filter(Boolean).join(" ")}
      onClick={() => {
        if (armed) {
          onConfirm();
        }
        setArmed(!armed);
      }}
    >
      {armed ? confirm : children}
    </button>
  );
};
