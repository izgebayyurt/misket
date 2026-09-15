import { expect } from "@wdio/globals";

const byTestId = (id) => $(`[data-testid="${id}"]`);

describe("Misket smoke", () => {
  it("opens the e2e project and shows the imported document", async () => {
    await byTestId("document-view").waitForExist({ timeout: 20000 });
    const text = await byTestId("doc-text").getText();
    expect(text).toContain("first interview transcript");
  });

  it("creates a code and applies it to a selection with the palette", async () => {
    await byTestId("tab-codes").click();
    await byTestId("new-code").click();
    await byTestId("code-name").setValue("Routine");
    await byTestId("code-submit").click();
    await expect(byTestId("code-item")).toBeExisting();

    // Select the first 12 characters of the document programmatically.
    await browser.execute(() => {
      const span = document.querySelector('[data-testid="doc-text"] span[data-s="0"]');
      const range = document.createRange();
      range.setStart(span.firstChild, 0);
      range.setEnd(span.firstChild, 12);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await byTestId("selection-toolbar").waitForExist({ timeout: 5000 });
    await browser.keys(["Control", "k"]);
    await byTestId("palette-input").waitForExist({ timeout: 5000 });
    await byTestId("palette-input").setValue("Rou");
    await browser.keys("Enter");

    await $("span[data-x]").waitForExist({ timeout: 5000 });
    const coded = await $("span[data-x]").getText();
    expect(coded).toBe("This is the"); // trailing whitespace is trimmed
    expect(await byTestId("status-counts").getText()).toContain("1 excerpts");
  });

  it("lists the excerpt in the browser", async () => {
    await byTestId("open-excerpts").click();
    await byTestId("excerpt-row").waitForExist({ timeout: 5000 });
    expect(await byTestId("excerpt-total").getText()).toContain("1 excerpt");
  });
});
