import type { ShotRecord, Variant } from "./shoot";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

const variantLabel = ({ theme, scheme, viewport }: Variant) => `${theme} · ${scheme} · ${viewport}`;

const cell = (shot: ShotRecord) => {
  const problems = shot.consoleErrors.length + shot.failedRequests.length;
  const badge = problems === 0 ? "" : `<span class="bad">${problems} error${problems === 1 ? "" : "s"}</span>`;
  const body =
    shot.outcome.kind === "captured"
      ? `<a href="${escapeHtml(shot.outcome.file)}"><img loading="lazy" src="${escapeHtml(shot.outcome.file)}" alt=""></a>`
      : `<div class="missing">${shot.outcome.kind === "http-error" ? `HTTP ${shot.outcome.status}` : escapeHtml(shot.outcome.message)}</div>`;
  const themeNote =
    shot.outcome.kind === "captured" && shot.outcome.appliedTheme !== shot.variant.theme
      ? `<span class="bad">data-theme=${escapeHtml(String(shot.outcome.appliedTheme))}</span>`
      : "";
  return `<figure>${body}<figcaption>${escapeHtml(variantLabel(shot.variant))} ${badge} ${themeNote}</figcaption></figure>`;
};

/** One section per page, one column per theme × scheme × viewport, so every variant sits side by side. */
export const renderContactSheet = (title: string, shots: readonly ShotRecord[]): string => {
  const pages = [...new Set(shots.map((shot) => shot.page))];
  const sections = pages.map((page) => {
    const row = shots.filter((shot) => shot.page === page);
    const path = row[0]?.path ?? "";
    return `<section><h2>${escapeHtml(page)} <code>${escapeHtml(path)}</code></h2><div class="row">${row.map(cell).join("")}</div></section>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 16px; background: #f4f4f2; color: #222; }
  h1 { font-size: 18px; } h2 { font-size: 15px; margin: 24px 0 8px; } code { color: #666; font-weight: normal; }
  .row { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; padding-bottom: 8px; }
  figure { margin: 0; flex: none; width: 240px; }
  img { width: 100%; max-height: 520px; object-fit: cover; object-position: top; border: 1px solid #ccc; background: #fff; }
  .missing { height: 160px; display: grid; place-items: center; border: 1px dashed #c33; color: #c33; padding: 8px; }
  figcaption { color: #555; margin-top: 4px; } .bad { color: #c33; font-weight: 600; }
</style></head><body><h1>${escapeHtml(title)}</h1>${sections.join("\n")}</body></html>
`;
};
