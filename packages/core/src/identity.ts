import { HttpError } from "./http";

export type Viewer = { readonly login: string };

export type IdentityMode = { readonly kind: "tailscale" } | { readonly kind: "fixed"; readonly viewer: Viewer };

/** Only trustworthy when the port is reachable solely through `tailscale serve`, which overwrites this header. */
const TAILSCALE_LOGIN_HEADER = "Tailscale-User-Login";

export const resolveViewer = (mode: IdentityMode, request: Request): Viewer => {
  switch (mode.kind) {
    case "fixed":
      return mode.viewer;
    case "tailscale": {
      const login = request.headers.get(TAILSCALE_LOGIN_HEADER);
      if (!login) {
        throw new HttpError(401, "Missing Tailscale identity");
      }
      return { login };
    }
  }
};
