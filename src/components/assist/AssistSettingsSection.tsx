import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/api/assist";
import type { AssistProvider } from "@/api/types";
import { flushSettings, useSettings } from "@/state/settings";
import { TOAST_KEYS, toast } from "@/state/toasts";
import { log } from "@/api/log";
import {
  MAX_CONTEXT_CHARS,
  MAX_EXCERPTS,
  MAX_PASSAGE_CHARS,
  MIN_EXCERPTS_FOR_DEFINITION,
} from "@/core/assist/prompts";
import { MAX_CODEBOOK_CODES } from "@/core/assist/codebook";
import { useAssistRequests, useAssistStatus } from "./useAssist";

const PROVIDERS: { value: AssistProvider; labelKey: string }[] = [
  { value: "anthropic", labelKey: "assist.providers.anthropic" },
  { value: "openAiCompatible", labelKey: "assist.providers.openAiCompatible" },
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
  const { t } = useTranslation();
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
      toast.info(key.trim() ? t("assist.keySaved") : t("assist.keyRemoved"));
    } catch (e) {
      toast.error(e, { key: TOAST_KEYS.assist });
    }
  }

  async function test() {
    setTesting(true);
    setTested(null);
    try {
      // Test what is on screen, not what was saved 400ms ago.
      await flushSettings();
      const reply = await api.testAssistConnection();
      setTested(t("assist.testAnswered", { model: reply.model, text: reply.text.trim().slice(0, 80) }));
    } catch (e) {
      setTested(null);
      log.error("assist connection test failed", {
        provider: settings.provider,
        model: settings.model,
      });
      toast.error(e, { key: TOAST_KEYS.assist });
    } finally {
      setTesting(false);
      void qc.invalidateQueries({ queryKey: ["assist", "requests"] });
    }
  }

  const anythingOn = settings.suggestCodes || settings.summariseCode || settings.suggestDefinition;

  return (
    <section data-testid="settings-assist">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("assist.title")}
      </h3>
      <p className="mb-3 text-xs text-fg-muted">{t("assist.blurb")}</p>

      <span className="mb-1 block text-sm" id="assist-provider-label">
        {t("assist.provider")}
      </span>
      <div className="flex gap-1" role="radiogroup" aria-labelledby="assist-provider-label">
        {PROVIDERS.map((p) => (
          <Button
            key={p.value}
            type="button"
            size="sm"
            variant={settings.provider === p.value ? "default" : "outline"}
            role="radio"
            aria-checked={settings.provider === p.value}
            onClick={() => patch({ provider: p.value })}
            data-testid={`assist-provider-${p.value}`}
          >
            {t(p.labelKey)}
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
            title={t("assist.ollamaPresetHint")}
            data-testid="assist-preset-ollama"
          >
            {t("assist.ollamaPreset")}
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm" htmlFor="assist-base-url">
          {t("assist.baseUrl")} {settings.provider === "anthropic" ? t("assist.optional") : ""}
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
            <Trans i18nKey="assist.baseUrlHintAnthropic" components={{ code: <code /> }} />
          ) : (
            <Trans i18nKey="assist.baseUrlHintOpenAi" components={{ code: <code /> }} />
          )}
        </p>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm" htmlFor="assist-model">
          {t("assist.model")}
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
          {t("assist.apiKey")}{" "}
          {settings.provider === "openAiCompatible" ? t("assist.apiKeyOftenNotNeeded") : ""}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="assist-key"
            type="password"
            value={key}
            placeholder={
              status?.hasKey ? t("assist.apiKeyStoredPlaceholder") : t("assist.apiKeyPastePlaceholder")
            }
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            data-testid="assist-key"
          />
          <Button type="button" size="sm" onClick={() => void saveKey()} disabled={!key.trim()}>
            {t("common.save")}
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
                .then(() => toast.info(t("assist.keyRemoved")))
                .catch((e) => toast.error(e, { key: TOAST_KEYS.assist }))
            }
          >
            {t("assist.forget")}
          </Button>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {t("assist.keyHint")}
          {status?.keyFromEnv ? ` ${t("assist.keyHintEnvVar")}` : ""}
          {status && !status.keychainAvailable ? ` ${t("assist.keyHintNoKeychain")}` : ""}
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
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}{" "}
          {t("assist.testConnection")}
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
          <span className="text-xs text-fg-muted">
            {t("assist.notReady", { reason: status.blocked })}
          </span>
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
          {t("assist.toggleSuggestCodes")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.summariseCode}
            onChange={(e) => patch({ summariseCode: e.target.checked })}
            data-testid="assist-toggle-summarise"
          />
          {t("assist.toggleSummarise")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.suggestDefinition}
            onChange={(e) => patch({ suggestDefinition: e.target.checked })}
            data-testid="assist-toggle-definition"
          />
          {t("assist.toggleDefinition")}
        </label>
      </div>

      <div className="mt-3 rounded-md border border-border bg-muted/40 p-2.5">
        <p className="text-xs font-semibold">{t("assist.whatGetsSentTitle")}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg-muted">
          <li>
            <Trans
              i18nKey="assist.whatGetsSentCodes"
              values={{
                passageChars: MAX_PASSAGE_CHARS,
                contextChars: MAX_CONTEXT_CHARS,
                maxCodes: MAX_CODEBOOK_CODES,
              }}
              components={{ strong: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="assist.whatGetsSentSummarise"
              values={{ maxExcerpts: MAX_EXCERPTS }}
              components={{ strong: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="assist.whatGetsSentDefinition"
              values={{ minExcerpts: MIN_EXCERPTS_FOR_DEFINITION }}
              components={{ strong: <strong /> }}
            />
          </li>
          <li>{t("assist.whatGetsSentNever")}</li>
        </ul>
        {anythingOn && settings.provider === "anthropic" ? (
          <p className="mt-1.5 text-xs text-fg-muted">{t("assist.anthropicWarning")}</p>
        ) : null}
      </div>

      <div className="mt-3">
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setShowLog((v) => !v)}
          data-testid="assist-log-toggle"
        >
          {showLog
            ? t("assist.hideLog", { count: requests?.length ?? 0 })
            : t("assist.showLog", { count: requests?.length ?? 0 })}
        </button>
        {showLog ? (
          <div className="mt-1.5" data-testid="assist-log">
            <table className="w-full text-[11px]">
              <thead className="text-fg-muted">
                <tr className="text-left">
                  <th className="font-medium">{t("assist.log.when")}</th>
                  <th className="font-medium">{t("assist.log.what")}</th>
                  <th className="font-medium">{t("assist.log.where")}</th>
                  <th className="text-right font-medium">{t("assist.log.sent")}</th>
                  <th className="text-right font-medium">{t("assist.log.back")}</th>
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
              <p className="text-xs text-fg-muted">{t("assist.log.nothingSent")}</p>
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
                {t("assist.log.clear")}
              </Button>
            )}
            <p className="mt-1 text-[11px] text-fg-muted">{t("assist.log.footer")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
