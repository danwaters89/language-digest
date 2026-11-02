import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DigestSchema, type Digest, type DigestIndex } from "./schema";

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/** Build the index from the digest files present in the directory, newest first. */
export async function buildIndex(outDir: string): Promise<DigestIndex> {
  const names = await readdir(outDir);
  const dates = names
    .map((n) => DATE_FILE.exec(n)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();
  return { latest: dates[0], dates };
}

/** Validate and write `<date>.json`, overwriting if present, then refresh `index.json`. */
export async function writeDigest(digest: Digest, outDir: string): Promise<{ file: string; index: DigestIndex }> {
  const valid = DigestSchema.parse(digest);
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${valid.date}.json`);
  await atomicWrite(file, JSON.stringify(valid, null, 2) + "\n");
  const index = await buildIndex(outDir);
  await atomicWrite(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return { file, index };
}
