import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/api/assist";
import type { AssistProvider } from "@/api/types";
import { flushSettings, useSettings } from "@/state/settings";
import { toast } from "@/state/toasts";
import { log } from "@/api/log";
import {
  MAX_CONTEXT_CHARS,
  MAX_EXCERPTS,
  MAX_PASSAGE_CHARS,
  MIN_EXCERPTS_FOR_DEFINITION,
} from "@/core/assist/prompts";
import { MAX_CODEBOOK_CODES } from "@/core/assist/codebook";
import { useAssistRequests, useAssistStatus } from "./useAssist";

const PROVIDERS: { value: AssistProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openAiCompatible", label: "OpenAI-compatible" },
];

/**
 * Settings → Assistance.
 *
 * The three toggles are the whole feature's on-switch and they start off.
 * Above them sits what a request needs; below them sits what a sceptic needs:
 * a plain statement of which text is sent, and a running list of every
 * request this session made, with its size but never its content.
 */
export function AssistSettingsSection() {
  const settings = useSettings((s) => s.settings.assist);
  const update = useSettings((s) => s.update);
  const qc = useQueryClient();
  const { data: status } = useAssistStatus();
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const { data: requests } = useAssistRequests(showLog);

  // Read the live store rather than this render's copy: two toggles flipped
  // in quick succession must not have the second one clobber the first.
  const patch = (p: Partial<typeof settings>) =>
    update({ assist: { ...useSettings.getState().settings.assist, ...p } });
  const refreshStatus = () => qc.invalidateQueries({ queryKey: ["assist", "status"] });

  async function saveKey() {
    try {
      await api.setAssistApiKey(key);
      setKey("");
      await refreshStatus();
      toast.info(key.trim() ? "API key saved to the system keychain." : "API key removed.");
    } catch (e) {
      toast.error(e);
    }
  }

  async function test() {
    setTesting(true);
    setTested(null);
    try {
      // Test what is on screen, not what was saved 400ms ago.
      await flushSettings();
      const reply = await api.testAssistConnection();
      setTested(`${reply.model} answered: ${reply.text.trim().slice(0, 80)}`);
    } catch (e) {
      setTested(null);
      log.error("assist connection test failed", {
        provider: settings.provider,
        model: settings.model,
      });
      toast.error(e);
    } finally {
      setTesting(false);
      void qc.invalidateQueries({ queryKey: ["assist", "requests"] });
    }
  }

  const anythingOn = settings.suggestCodes || settings.summariseCode || settings.suggestDefinition;

  return (
    <section data-testid="settings-assist">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Assistance
      </h3>
      <p className="mb-3 text-xs text-fg-muted">
        Misket can ask a language model for suggestions. It is off until you switch it on, it never
        applies anything by itself, and everything it proposes is something you accept by clicking
        it. With nothing configured below, nothing ever leaves this computer.
      </p>

      <label className="mb-1 block text-sm" htmlFor="assist-provider">
        Provider
      </label>
      <div className="flex gap-1" role="radiogroup" aria-label="Assistance provider">
        {PROVIDERS.map((p) => (
          <Button
            key={p.value}
            type="button"
            size="sm"
            variant={settings.provider === p.value ? "default" : "outline"}
            aria-pressed={settings.provider === p.value}
            onClick={() => patch({ provider: p.value })}
            data-testid={`assist-provider-${p.value}`}
          >
            {p.label}
          </Button>
        ))}
        {settings.provider === "openAiCompatible" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              patch({ baseUrl: status?.ollamaBaseUrl ?? "http://localhost:11434/v1", model: "" })
            }
            title="A model running on this machine. No key, nothing over the network."
            data-testid="assist-preset-ollama"
          >
            Local (Ollama)
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm" htmlFor="assist-base-url">
          Base URL {settings.provider === "anthropic" ? "(optional)" : ""}
        </label>
        <Input
          id="assist-base-url"
          value={settings.baseUrl}
          placeholder={
            settings.provider === "anthropic"
              ? "https://api.anthropic.com"
              : "http://localhost:11434/v1"
          }
          onChange={(e) => patch({ baseUrl: e.target.value })}
          data-testid="assist-base-url"
        />
        <p className="mt-1 text-xs text-fg-muted">
          {settings.provider === "anthropic" ? (
            <>
              Leave it empty for Anthropic&rsquo;s own API. Set it to point at a gateway or proxy
              that speaks the Messages API; Misket adds <code>/v1/messages</code>.
            </>
          ) : (
            <>
              Anything that speaks the OpenAI chat API: Ollama, LM Studio, llama.cpp, a university
              gateway, OpenAI itself. Misket adds <code>/chat/completions</code>.
            </>
          )}
        </p>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm" htmlFor="assist-model">
          Model
        </label>
        <Input
          id="assist-model"
          value={settings.model}
          list="assist-model-options"
          placeholder={settings.provider === "anthropic" ? "claude-sonnet-5" : "llama3.1"}
          onChange={(e) => patch({ model: e.target.value })}
          data-testid="assist-model"
        />
        {settings.provider === "anthropic" ? (
          <datalist id="assist-model-options">
            {(status?.anthropicModels ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        ) : null}
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm" htmlFor="assist-key">
          API key {settings.provider === "openAiCompatible" ? "(often not needed locally)" : ""}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="assist-key"
            type="password"
            value={key}
            placeholder={status?.hasKey ? "•••••••• (a key is stored)" : "Paste a key to store it"}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            data-testid="assist-key"
          />
          <Button type="button" size="sm" onClick={() => void saveKey()} disabled={!key.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!status?.hasKey}
            onClick={() =>
              void api
                .clearAssistApiKey()
                .then(refreshStatus)
                .then(() => toast.info("API key removed."))
                .catch(toast.error)
            }
          >
            Forget
          </Button>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Stored in your operating system&rsquo;s keychain, never in Misket&rsquo;s settings file
          and never in a project.
          {status?.keyFromEnv ? " Currently using the key from MISKET_ASSIST_API_KEY." : ""}
          {status && !status.keychainAvailable
            ? " This computer has no usable keychain, so a key typed here lasts only until Misket closes."
            : ""}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void test()}
          disabled={testing}
          data-testid="assist-test"
        >
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : null} Test connection
        </Button>
        {tested ? (
          <span
            className="flex items-center gap-1 text-xs text-fg-muted"
            data-testid="assist-test-result"
          >
            <Check className="size-3.5 text-accent" /> {tested}
          </span>
        ) : null}
        {status?.blocked ? (
          <span className="text-xs text-fg-muted">Not ready: {status.blocked}.</span>
        ) : null}
      </div>

      <div className="mt-4 space-y-2" data-testid="assist-toggles">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.suggestCodes}
            onChange={(e) => patch({ suggestCodes: e.target.checked })}
            data-testid="assist-toggle-suggest-codes"
          />
          Suggest codes for a selection
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.summariseCode}
            onChange={(e) => patch({ summariseCode: e.target.checked })}
            data-testid="assist-toggle-summarise"
          />
          Summarise a code&rsquo;s excerpts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.suggestDefinition}
            onChange={(e) => patch({ suggestDefinition: e.target.checked })}
            data-testid="assist-toggle-definition"
          />
          Suggest a definition for a code
        </label>
      </div>

      <div className="mt-3 rounded-md border border-border bg-muted/40 p-2.5">
        <p className="text-xs font-semibold">What gets sent</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg-muted">
          <li>
            <strong>Suggesting codes:</strong> the passage you selected (up to{" "}
            {MAX_PASSAGE_CHARS.toLocaleString()} characters), one paragraph either side of it (up to{" "}
            {MAX_CONTEXT_CHARS.toLocaleString()} characters each), and your code names with their
            definitions (up to {MAX_CODEBOOK_CODES}; past that, the ones whose wording is closest to
            the passage).
          </li>
          <li>
            <strong>Summarising a code:</strong> up to {MAX_EXCERPTS} excerpts carrying that code,
            with the document names, and the code&rsquo;s own name and definition.
          </li>
          <li>
            <strong>Drafting a definition:</strong> the same excerpts, for one code with at least{" "}
            {MIN_EXCERPTS_FOR_DEFINITION} of them.
          </li>
          <li>
            Never a whole document, never the project, never your memos, never anything for a
            feature you have not switched on.
          </li>
        </ul>
        {anythingOn && settings.provider === "anthropic" ? (
          <p className="mt-1.5 text-xs text-fg-muted">
            Anthropic is a service on the internet. If your ethics approval or data agreement does
            not allow sending this material off the machine, use the Local (Ollama) preset instead.
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setShowLog((v) => !v)}
          data-testid="assist-log-toggle"
        >
          {showLog ? "Hide" : "Show"} what was sent ({requests?.length ?? 0} this session)
        </button>
        {showLog ? (
          <div className="mt-1.5" data-testid="assist-log">
            <table className="w-full text-[11px]">
              <thead className="text-fg-muted">
                <tr className="text-left">
                  <th className="font-medium">When</th>
                  <th className="font-medium">What</th>
                  <th className="font-medium">Where</th>
                  <th className="text-right font-medium">Sent</th>
                  <th className="text-right font-medium">Back</th>
                </tr>
              </thead>
              <tbody>
                {(requests ?? []).map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-t border-border">
                    <td className="py-0.5 tabular-nums">{e.at.slice(11, 19)}</td>
                    <td>{e.feature}</td>
                    <td title={e.provider} data-testid="assist-log-model">
                      {e.model}
                    </td>
                    <td className="text-right tabular-nums">{e.requestBytes} B</td>
                    <td className="text-right tabular-nums">
                      {e.outcome === "ok" ? `${e.responseBytes} B` : e.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(requests?.length ?? 0) === 0 ? (
              <p className="text-xs text-fg-muted">Nothing has been sent.</p>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={() =>
                  void api
                    .clearAssistRequests()
                    .then(() => qc.invalidateQueries({ queryKey: ["assist", "requests"] }))
                }
              >
                Clear the list
              </Button>
            )}
            <p className="mt-1 text-[11px] text-fg-muted">
              Sizes and times only — the list never holds the text itself, so it is safe to show
              anyone. It covers this session; it is not written to disk.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
