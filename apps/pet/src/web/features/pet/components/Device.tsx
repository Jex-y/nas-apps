import type { ReactNode } from "react";

/** The egg-shaped handheld the pet lives in: a screen above a row of buttons. */
export const Device = ({
  screen,
  dim = false,
  children,
}: {
  screen: ReactNode;
  /** Lights out while the pet sleeps. */
  dim?: boolean;
  children: ReactNode;
}) => (
  <div className="device">
    <div className={dim ? "screen dim" : "screen"}>{screen}</div>
    <div className="device-buttons">{children}</div>
  </div>
);
