import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { useToasts } from "@/state/toasts";
import { Toaster } from "./Toaster";

/**
 * A render-level check that the i18next wiring actually reaches a component,
 * not just that the resource files parse: mount a real, already-shipped
 * component (Toaster — no react-query dependency, just the toasts store) with
 * the locale switched to Turkish and find Turkish text in the result.
 */
describe("Toaster under tr", () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders its aria-labels and repeat count in Turkish", async () => {
    await i18n.changeLanguage("tr");
    // Push the same keyed message twice: the second nudges rather than
    // stacking (see src/state/toasts.ts), which is what puts the "×2" /
    // "2 kez söylendi" repeat-count chip on screen.
    useToasts.getState().push("info", "Test mesajı", { key: "test" });
    useToasts.getState().push("info", "Test mesajı", { key: "test" });

    render(<Toaster />);

    // The dismiss button's aria-label: settings.language.tr's own word for
    // "Dismiss" — proves useTranslation() picked up the tr resources.
    expect(screen.getByLabelText("Kapat")).toBeInTheDocument();
    // The pluralized, interpolated repeat-count title.
    expect(screen.getByTestId("toast-repeat-count")).toHaveAttribute("title", "2 kez söylendi");
  });
});
