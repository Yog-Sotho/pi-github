import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';
import { logger } from './logger.js';

/** True when `child` is `root` itself or contained within it. */
function isWithin(root: string, child: string): boolean {
  return child === root || child.startsWith(root + path.sep);
}

export class SecuritySandbox {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Resolve `targetPath` relative to the workspace root and reject anything
   * that escapes it — via `..` traversal or via symlinks. Comparison is
   * path-boundary aware, so a sibling like `/work-evil` cannot pass for a
   * root of `/work`.
   */
  async validatePath(targetPath: string): Promise<string> {
    const resolved = path.resolve(this.workspaceRoot, targetPath);

    if (!isWithin(this.workspaceRoot, resolved)) {
      throw new Error(`Path traversal detected: ${targetPath}`);
    }

    // Resolve the root itself too: the workspace may live behind a symlink
    // (e.g. /tmp on macOS), which would otherwise cause false positives.
    const realRoot = await fs.realpath(this.workspaceRoot);

    try {
      const realPath = await fs.realpath(resolved);
      if (!isWithin(realRoot, realPath)) {
        throw new Error(`Symlink escape detected: ${targetPath}`);
      }
      return realPath;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Path does not exist yet (e.g. a file about to be created).
        return resolved;
      }
      throw err;
    }
  }

  static async createIsolatedTempDir(): Promise<string> {
    const dir = path.join(os.tmpdir(), `pi-github-${crypto.randomUUID()}`);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    logger.debug({ dir }, 'Created isolated temp directory');
    return dir;
  }

  static async destroyIsolatedTempDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      logger.debug({ dir }, 'Destroyed isolated temp directory');
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to destroy temp directory');
    }
  }
}
