// JSON-файл дерекқоры. Firebase бапталмағанда қолданылады.
// Барлық жазу операциялары кезек арқылы орындалады (жаттың бұзылмауы үшін).
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config.js";
import type { EvaluationRecord, RubricVersion } from "@gha/shared";
import { DEFAULT_RUBRIC } from "@gha/shared";

interface DbShape {
  evaluations: EvaluationRecord[];
  rubrics: RubricVersion[];
  activeRubricVersion: string;
}

const dbPath = () => path.join(CONFIG.dataDir, "db.json");

let writeQueue: Promise<unknown> = Promise.resolve();
let cache: DbShape | null = null;

async function ensureFile(): Promise<void> {
  await fs.mkdir(CONFIG.dataDir, { recursive: true });
  await fs.mkdir(CONFIG.evidenceDir, { recursive: true });
  try {
    await fs.access(dbPath());
  } catch {
    await fs.writeFile(dbPath(), JSON.stringify({ evaluations: [], rubrics: [DEFAULT_RUBRIC], activeRubricVersion: DEFAULT_RUBRIC.version } satisfies DbShape, null, 2));
  }
}

export async function readDb(): Promise<DbShape> {
  if (cache) return cache;
  await ensureFile();
  const raw = await fs.readFile(dbPath(), "utf-8");
  cache = JSON.parse(raw) as DbShape;
  if (!cache.rubrics?.length) cache.rubrics = [DEFAULT_RUBRIC];
  return cache;
}

async function writeDb(db: DbShape): Promise<void> {
  const tmp = dbPath() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, dbPath());
  cache = db;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

export async function listEvaluations(): Promise<EvaluationRecord[]> {
  const db = await readDb();
  return [...db.evaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getEvaluation(id: string): Promise<EvaluationRecord | undefined> {
  const db = await readDb();
  return db.evaluations.find((e) => e.id === id);
}

export async function saveEvaluation(rec: EvaluationRecord): Promise<void> {
  await enqueue(async () => {
    const db = await readDb();
    const idx = db.evaluations.findIndex((e) => e.id === rec.id);
    if (idx >= 0) db.evaluations[idx] = rec;
    else db.evaluations.push(rec);
    await writeDb({ ...db });
  });
}

export async function deleteEvaluation(id: string): Promise<boolean> {
  return enqueue(async () => {
    const db = await readDb();
    const before = db.evaluations.length;
    db.evaluations = db.evaluations.filter((e) => e.id !== id);
    await writeDb({ ...db });
    return db.evaluations.length < before;
  });
}

export async function getActiveRubric(): Promise<RubricVersion> {
  const db = await readDb();
  return db.rubrics.find((r) => r.version === db.activeRubricVersion) ?? db.rubrics[db.rubrics.length - 1];
}

export async function getRubricVersion(version: string): Promise<RubricVersion | undefined> {
  const db = await readDb();
  return db.rubrics.find((r) => r.version === version);
}

export async function saveRubric(rubric: RubricVersion): Promise<void> {
  await enqueue(async () => {
    const db = await readDb();
    const idx = db.rubrics.findIndex((r) => r.version === rubric.version);
    if (idx >= 0) db.rubrics[idx] = rubric;
    else db.rubrics.push(rubric);
    db.activeRubricVersion = rubric.version;
    await writeDb({ ...db });
  });
}

export async function listRubrics(): Promise<RubricVersion[]> {
  const db = await readDb();
  return [...db.rubrics].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
