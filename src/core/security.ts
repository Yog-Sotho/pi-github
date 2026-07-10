import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

export class SecuritySandbox {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  async validatePath(targetPath: string): Promise<string> {
    const resolved = path.resolve(this.workspaceRoot, targetPath);
    
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal detected: ${targetPath}`);
    }

    try {
      const realPath = await fs.realpath(resolved);
      if (!realPath.startsWith(this.workspaceRoot)) {
        throw new Error(`Symlink escape detected: ${targetPath}`);
      }
      return realPath;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return resolved;
      }
      throw err;
    }
  }

  static async createIsolatedTempDir(): Promise<string> {
    const dir = path.join(os.tmpdir(), `pi-github-${uuidv4()}`);
    await fs.mkdir(dir, { recursive: true });
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