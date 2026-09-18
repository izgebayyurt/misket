import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { StartScreen } from "@/components/project/StartScreen";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { renderWithProviders } from "@/test-utils/renderWithProviders";

// These are the two full-screen "views" that render without an open project
// or document and so need no backend data beyond an empty recent-projects
// list: everything else in the app (the workspace, the document view, the
// code tree, the excerpt browser…) only renders once a project is open,
// which pulls in enough live query state that mocking it accurately in
// jsdom is more elaborate than a mechanical a11y pass calls for. Those are
// checked instead by running axe against the real, headless app (see
// e2e/a11y and the hand-back for before/after violation counts).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/**
 * Only the checks the roadmap item asks for — labels, roles and names — not
 * the full axe ruleset: layout-dependent rules like colour contrast can't
 * run meaningfully in jsdom (no real rendering), and contrast has its own
 * test against the design tokens in `src/core/contrast.test.ts`.
 */
const RULES = [
  "aria-allowed-attr",
  "aria-allowed-role",
  "aria-command-name",
  "aria-dialog-name",
  "aria-hidden-focus",
  "aria-input-field-name",
  "aria-required-attr",
  "aria-required-children",
  "aria-required-parent",
  "aria-roles",
  "aria-toggle-field-name",
  "aria-valid-attr",
  "aria-valid-attr-value",
  "button-name",
  "duplicate-id",
  "duplicate-id-aria",
  "form-field-multiple-labels",
  "image-alt",
  "input-button-name",
  "label",
  "link-name",
  "select-name",
  "svg-img-alt",
];

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "rule", values: RULES },
  });
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}

describe("accessibility: static view shells", () => {
  it("the start screen has no label/role/name violations", async () => {
    const { container } = renderWithProviders(<StartScreen />);
    await expectNoViolations(container);
  });

  it("the settings dialog has no label/role/name violations", async () => {
    const { container } = renderWithProviders(<SettingsDialog onClose={() => {}} />);
    await expectNoViolations(container);
  });
});
