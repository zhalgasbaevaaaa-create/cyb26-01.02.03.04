import { useEffect, useState } from "react";
import { api } from "../api";
import { kz } from "@gha/shared";
import { Spinner } from "../components/ui";

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

  useEffect(() => {
    api.get<SystemInfo>("/api/system/info").then(setInfo).catch(() => setInfo(null));
  }, []);

  if (!info) return <Spinner />;

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

      <div className="card text-sm text-gray-300">
        <p>{kz.settings.envHint}</p>
      </div>
    </div>
  );
}
