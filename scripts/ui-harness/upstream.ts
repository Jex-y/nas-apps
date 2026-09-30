/** Where the deployed stack lives: `UI_HARNESS_UPSTREAM`, else `https://apps.<tailnet>` from this machine's Tailscale. */
const TAILSCALE_BINARIES = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

const run = (command: readonly string[]) => {
  try {
    return Bun.spawnSync([...command], { stdout: "pipe", stderr: "ignore" });
  } catch {
    return null;
  }
};

const tailnetSuffix = (): string | null => {
  for (const binary of TAILSCALE_BINARIES) {
    const result = run([binary, "status", "--json"]);
    if (result?.success) {
      const status: { readonly MagicDNSSuffix?: string } = JSON.parse(result.stdout.toString());
      return status.MagicDNSSuffix ?? null;
    }
  }
  return null;
};

export const resolveUpstream = (env: Readonly<Record<string, string | undefined>>): URL => {
  const configured = env.UI_HARNESS_UPSTREAM;
  if (configured !== undefined && configured !== "") {
    return new URL(configured);
  }
  const suffix = tailnetSuffix();
  if (suffix === null) {
    throw new Error("Could not read the tailnet from `tailscale status --json`; set UI_HARNESS_UPSTREAM");
  }
  return new URL(`https://apps.${suffix}/`);
};
