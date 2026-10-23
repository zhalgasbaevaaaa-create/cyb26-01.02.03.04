import { kz } from "@gha/shared";
import type { JobStatus, TestStatus } from "@gha/shared";
import { fetchBlob } from "../api";

export function StatusBadge({ status }: { status: TestStatus }) {
  return <span className={`font-medium status-${status}`}>{kz.test[status]}</span>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const cls: Record<JobStatus, string> = {
    queued: "bg-gray-600",
    running: "bg-blue-600 animate-pulse",
    completed: "bg-green-700",
    failed: "bg-red-700",
    blocked: "bg-orange-700",
    cancelled: "bg-gray-500",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs text-white ${cls[status]}`}>{kz.status[status]}</span>;
}

export function DownloadButton({ path, filename, label }: { path: string; filename: string; label: string }) {
  async function download() {
    try {
      const blob = await fetchBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : kz.common.error);
    }
  }
  return (
    <button className="btn-secondary" onClick={download}>
      {label}
    </button>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center gap-2 text-gray-400">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
      {kz.common.loading}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="card text-center text-gray-400 py-10">{text}</div>;
}

export function ErrorBox({ message, details }: { message: string; details?: string[] }) {
  return (
    <div className="rounded-lg border border-red-700 bg-red-950/40 p-3 text-sm text-red-300">
      <p>{message}</p>
      {details && details.length > 0 && (
        <ul className="list-disc pl-5 mt-1">
          {details.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}
