import { useEffect, useState } from "react";
import { api } from "../api";
import { kz, TEST_MODULE_KEYS, TEST_MODULE_LABELS, validateModuleSettings } from "@gha/shared";
import type { ModuleSettings } from "@gha/shared";
import { ErrorBox, Spinner } from "../components/ui";

interface SystemInfo {
  version: string;
  playwrightReady: boolean;
  fixtureEnabled: boolean;
  firebaseConfigured: boolean;
  googleOAuthConfigured: boolean;
  database: string;
}

function Row({ label, ok, okLabel, badLabel }: { label: string; ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-800 text-sm">
      <span>{label}</span>
      <span className={`rounded-full px-3 py-0.5 text-xs ${ok ? "bg-green-800 text-green-200" : "bg-yellow-800 text-yellow-200"}`}>
        {ok ? okLabel : badLabel}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [modules, setModules] = useState<ModuleSettings | null>(null);
  const [draft, setDraft] = useState<ModuleSettings | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SystemInfo>("/api/system/info").then(setInfo).catch(() => setInfo(null));
    api.get<ModuleSettings>("/api/settings/modules")
      .then((d) => { setModules(d); setDraft(JSON.parse(JSON.stringify(d))); })
      .catch(() => undefined);
  }, []);

  if (!info) return <Spinner />;

  const validation = draft ? validateModuleSettings(draft) : { valid: false, errors: [] };

  function toggleModule(key: (typeof TEST_MODULE_KEYS)[number]) {
    setDraft((d) => d && { ...d, enabledModules: { ...d.enabledModules, [key]: !d.enabledModules[key] } });
    setMessage("");
  }

  function setTimeout_(field: keyof ModuleSettings["timeouts"], value: number) {
    setDraft((d) => d && { ...d, timeouts: { ...d.timeouts, [field]: value } });
    setMessage("");
  }

  async function saveModules() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      const res = await api.put<{ settings: ModuleSettings; message: string }>("/api/settings/modules", draft);
      setModules(res.settings);
      setDraft(JSON.parse(JSON.stringify(res.settings)));
      setMessage(res.message);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : kz.common.error, details: (e as { details?: string[] }).details });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gold">{kz.settings.title}</h1>

      <div className="card">
        <h2 className="font-semibold mb-2">{kz.settings.infrastructure}</h2>
        <Row label={`${kz.settings.version}`} ok okLabel={info.version} badLabel="" />
        <Row label={kz.settings.playwright} ok={info.playwrightReady} okLabel={kz.settings.available} badLabel={kz.settings.unavailable} />
        <Row label={`${kz.settings.database}: ${info.database}`} ok okLabel={kz.settings.available} badLabel={kz.settings.unavailable} />
        <Row label={kz.settings.firebase} ok={info.firebaseConfigured} okLabel={kz.settings.configured} badLabel={kz.settings.notConfigured} />
        <Row label={kz.settings.googleOAuth} ok={info.googleOAuthConfigured} okLabel={kz.settings.configured} badLabel={kz.settings.notConfigured} />
        <Row label={kz.settings.ssrf} ok okLabel={kz.settings.enabled} badLabel="—" />
        <Row label={kz.settings.testFixture} ok={info.fixtureEnabled} okLabel={kz.settings.enabled} badLabel="—" />
        <p className="text-xs text-gray-500 mt-3">{kz.settings.testFixtureHint}</p>
      </div>

      {draft && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Тест модульдері</h2>
          <p className="text-xs text-gray-400">
            Өшірілген модульдің тиісті талаптары «Тексерілмеді» күйінде қалады және ұпайға әсер етпейді
            (ешқашан 0 деп саналмайды). Міндетті негізгі кезеңдер (URL тексеру, жүктеу, браузер,
            Requirements/Бағалау/Есеп) әрқашан орындалады — өшіру мүмкін емес.
          </p>
          <div className="divide-y divide-gray-800">
            {TEST_MODULE_KEYS.map((key) => (
              <label key={key} className="flex items-center justify-between gap-3 py-2 text-sm cursor-pointer">
                <span>{TEST_MODULE_LABELS[key]}</span>
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-gold"
                  checked={draft.enabledModules[key]}
                  onChange={() => toggleModule(key)}
                />
              </label>
            ))}
          </div>

          <div className="border-t border-gray-700 pt-3 space-y-2">
            <h2 className="font-semibold text-sm">Тест таймауттары</h2>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm">Бетті жүктеу таймауты (мс)</span>
              <input
                type="number" min={2000} max={120000} step={1000} className="input w-28 text-right"
                value={draft.timeouts.navTimeoutMs}
                onChange={(e) => setTimeout_("navTimeoutMs", Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm">Бір әрекет таймауты (мс)</span>
              <input
                type="number" min={1000} max={60000} step={500} className="input w-28 text-right"
                value={draft.timeouts.pageActionTimeoutMs}
                onChange={(e) => setTimeout_("pageActionTimeoutMs", Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm">Жалпы тексеру таймауты (мс)</span>
              <input
                type="number" min={30000} max={1800000} step={10000} className="input w-28 text-right"
                value={draft.timeouts.jobTimeoutMs}
                onChange={(e) => setTimeout_("jobTimeoutMs", Number(e.target.value))}
              />
            </div>
          </div>

          {error && <ErrorBox message={error.message} details={error.details} />}
          {message && <p className="text-green-400 text-sm">{message}</p>}
          {!validation.valid && (
            <ul className="text-xs text-red-400 list-disc pl-5">
              {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={saveModules} disabled={!validation.valid || saving}>
              {saving ? kz.common.loading : kz.common.save}
            </button>
          </div>
          {modules?.updatedAt && modules.updatedAt !== "1970-01-01T00:00:00.000Z" && (
            <p className="text-xs text-gray-500">Соңғы сақталған: {new Date(modules.updatedAt).toLocaleString("kk-KZ")}</p>
          )}
        </div>
      )}

      <div className="card text-sm text-gray-300">
        <p>{kz.settings.envHint}</p>
      </div>
    </div>
  );
}
