import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "./workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
});

describe("workspace: focus scope", () => {
  it("selecting a code clears the focused excerpt and pending selection", () => {
    const ws = useWorkspace.getState();
    ws.setFocusedExcerptId("excerpt-1");
    expect(useWorkspace.getState().focusedExcerptId).toBe("excerpt-1");

    ws.setSelectedCodeId("code-1");
    const after = useWorkspace.getState();
    expect(after.selectedCodeId).toBe("code-1");
    expect(after.focusedExcerptId).toBeNull();
    expect(after.pendingSelection).toBeNull();
  });

  it("also clears a pending text selection when a code is selected", () => {
    const ws = useWorkspace.getState();
    ws.setPendingSelection({ documentId: "doc-1", kind: "text", start: 0, end: 3 });
    ws.setSelectedCodeId("code-1");
    expect(useWorkspace.getState().pendingSelection).toBeNull();
  });

  it("focusing an excerpt again switches back and clears the code selection is not required", () => {
    // Focusing an excerpt is its own mutually-exclusive target against a
    // pending selection, but it does not need to clear the tree's selected
    // code — the panel prioritizes a focused excerpt over the code scope.
    const ws = useWorkspace.getState();
    ws.setSelectedCodeId("code-1");
    ws.setFocusedExcerptId("excerpt-1");
    const after = useWorkspace.getState();
    expect(after.focusedExcerptId).toBe("excerpt-1");
    expect(after.selectedCodeId).toBe("code-1");
  });

  it("deselecting a code (passing null) leaves an unrelated focused excerpt alone", () => {
    const ws = useWorkspace.getState();
    ws.setSelectedCodeId(null);
    expect(useWorkspace.getState().selectedCodeId).toBeNull();
    expect(useWorkspace.getState().focusedExcerptId).toBeNull();
  });
});
