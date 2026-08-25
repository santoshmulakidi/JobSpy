import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RECORDING_EXTENSIONS = new Set([
  '.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.pcm', '.raw', '.wav', '.webm',
]);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

export function snapshotRecordingFiles(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  visit(root, root, snapshot);
  return snapshot;
}

function visit(root: string, directory: string, snapshot: Record<string, string>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        visit(root, join(directory, entry.name), snapshot);
      }
      continue;
    }
    const extensionIndex = entry.name.lastIndexOf('.');
    const extension = extensionIndex < 0 ? '' : entry.name.slice(extensionIndex).toLowerCase();
    if (!RECORDING_EXTENSIONS.has(extension)) {
      continue;
    }
    const path = join(directory, entry.name);
    const stat = statSync(path);
    snapshot[relative(root, path)] = `${stat.size}:${stat.mtimeMs}`;
  }
}
