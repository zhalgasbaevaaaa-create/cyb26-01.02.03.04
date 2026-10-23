// Жауаптар кілті (міндетті емес): data/answer_key.json
// Форматы: [{ "question": "...", "answer": "..." }, ...]
// Кілт болмаса — тарихи дәлдік автоматты тексерілмейді («Тексерілмеді»).
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config.js";

export interface AnswerKeyEntry {
  question: string;
  answer: string;
}

export async function loadAnswerKey(): Promise<AnswerKeyEntry[] | null> {
  const p = path.join(CONFIG.dataDir, "answer_key.json");
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((e) => typeof e?.question === "string" && typeof e?.answer === "string")) {
      return parsed as AnswerKeyEntry[];
    }
    return null;
  } catch {
    return null;
  }
}

export interface KeyMatch {
  question: string;
  expectedAnswer: string;
  foundInPage: boolean;
  correct: boolean | null; // null — бетте жауап нұсқалары табылмады
}

/**
 * Беттен табылған сұрақтарды кілтпен салыстыру.
 * Сұрақ сәйкестігі: кілт сұрағының негізгі сөздері бет мәтінінде кездессе.
 */
export function compareAgainstKey(pageText: string, key: AnswerKeyEntry[]): KeyMatch[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[«»"'?!.,;]/g, "").replace(/\s+/g, " ").trim();
  const text = normalize(pageText);
  return key.map((entry) => {
    const qWords = normalize(entry.question).split(" ").filter((w) => w.length > 3);
    const hits = qWords.filter((w) => text.includes(w)).length;
    const foundInPage = qWords.length > 0 && hits / qWords.length >= 0.6;
    if (!foundInPage) return { question: entry.question, expectedAnswer: entry.answer, foundInPage: false, correct: null };
    const correct = text.includes(normalize(entry.answer));
    return { question: entry.question, expectedAnswer: entry.answer, foundInPage: true, correct };
  });
}
