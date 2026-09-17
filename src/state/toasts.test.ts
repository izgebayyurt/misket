import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISS_MS, toast, useToasts } from "./toasts";

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  // Run out any armed dismiss timers so they cannot fire into the next test.
  vi.runAllTimers();
  vi.useRealTimers();
});

const messages = () => useToasts.getState().toasts.map((t) => t.message);

describe("toast stacking", () => {
  it("stacks unkeyed toasts, even identical ones", () => {
    toast.info("Saved");
    toast.info("Saved");
    expect(messages()).toEqual(["Saved", "Saved"]);
  });

  it("dismisses a toast on its own after the timeout", () => {
    toast.info("Saved");
    vi.advanceTimersByTime(DISMISS_MS - 1);
    expect(messages()).toEqual(["Saved"]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("keeps toasts with different keys apart", () => {
    toast.info("Nothing to redo", { key: "a" });
    toast.info("Nothing to redo", { key: "b" });
    expect(messages()).toEqual(["Nothing to redo", "Nothing to redo"]);
  });
});

describe("coalescing by key", () => {
  it("reuses one toast for a repeat and counts the nudges", () => {
    toast.info("Nothing to redo", { key: "k" });
    toast.info("Nothing to redo", { key: "k" });
    toast.info("Nothing to redo", { key: "k" });

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe("Nothing to redo");
    // Three presses: one toast, nudged twice.
    expect(toasts[0]!.nudge).toBe(2);
  });

  it("keeps the same toast id, so the component animates rather than remounts", () => {
    toast.info("Nothing to redo", { key: "k" });
    const id = useToasts.getState().toasts[0]!.id;
    toast.info("Nothing to redo", { key: "k" });
    expect(useToasts.getState().toasts[0]!.id).toBe(id);
  });

  it("replaces the message without nudging when the words change", () => {
    toast.info("Undid: added a code", { key: "k" });
    toast.info("Undid: created a code", { key: "k" });

    const [t] = useToasts.getState().toasts;
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(t!.message).toBe("Undid: created a code");
    expect(t!.nudge).toBe(0);
  });

  it("starts nudging again once the message settles", () => {
    toast.info("Undid: created a code", { key: "k" });
    toast.info("Nothing left to undo", { key: "k" });
    toast.info("Nothing left to undo", { key: "k" });
    expect(useToasts.getState().toasts[0]!.nudge).toBe(1);
  });

  it("treats an error and an info with the same words as a change, not a repeat", () => {
    toast.info("Busy", { key: "k" });
    toast.error(new Error("Busy"), { key: "k" });
    const [t] = useToasts.getState().toasts;
    expect(t!.kind).toBe("error");
    expect(t!.nudge).toBe(0);
  });
});

describe("the dismiss timer", () => {
  it("restarts on every repeat", () => {
    toast.info("Nothing to redo", { key: "k" });
    vi.advanceTimersByTime(DISMISS_MS - 100);
    toast.info("Nothing to redo", { key: "k" });
    // Had the timer not been restarted, the toast would be gone by now.
    vi.advanceTimersByTime(200);
    expect(messages()).toEqual(["Nothing to redo"]);
    vi.advanceTimersByTime(DISMISS_MS);
    expect(messages()).toEqual([]);
  });

  it("does not leave a stale timer that clears a later toast", () => {
    toast.info("Nothing to redo", { key: "k" });
    vi.advanceTimersByTime(DISMISS_MS);
    expect(messages()).toEqual([]);
    toast.info("Nothing to redo", { key: "k" });
    vi.advanceTimersByTime(100);
    expect(messages()).toEqual(["Nothing to redo"]);
    // And the fresh toast is a fresh toast, not the old one nudged.
    expect(useToasts.getState().toasts[0]!.nudge).toBe(0);
  });

  it("cancels the timer when dismissed by hand", () => {
    toast.info("Nothing to redo", { key: "k" });
    const id = useToasts.getState().toasts[0]!.id;
    useToasts.getState().dismiss(id);
    expect(messages()).toEqual([]);
    toast.info("Another", { key: "other" });
    vi.advanceTimersByTime(DISMISS_MS - 1);
    expect(messages()).toEqual(["Another"]);
  });
});
