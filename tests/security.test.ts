import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SecuritySandbox } from '../src/core/security.js';

describe('SecuritySandbox', () => {
  let tempDir: string;
  let sandbox: SecuritySandbox;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-test-'));
    sandbox = new SecuritySandbox(tempDir);
    await fs.writeFile(path.join(tempDir, 'safe.txt'), 'safe');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows valid paths', async () => {
    const resolved = await sandbox.validatePath('safe.txt');
    expect(resolved).toBe(path.join(await fs.realpath(tempDir), 'safe.txt'));
  });

  it('allows not-yet-existing paths inside the workspace', async () => {
    const resolved = await sandbox.validatePath('new/file.txt');
    expect(resolved).toBe(path.join(tempDir, 'new', 'file.txt'));
  });

  it('blocks directory traversal', async () => {
    await expect(sandbox.validatePath('../../../etc/passwd')).rejects.toThrow('Path traversal detected');
  });

  it('blocks sibling directories sharing the root as a prefix', async () => {
    // /tmp/pi-test-xyz-evil starts with /tmp/pi-test-xyz as a *string* but is
    // outside the sandbox; the naive startsWith check used to allow this.
    await expect(sandbox.validatePath(`${tempDir}-evil/file.txt`)).rejects.toThrow('Path traversal detected');
  });

  it('blocks symlink escapes', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideFile, 'secret');

    const symlink = path.join(tempDir, 'escape');
    await fs.symlink(outsideFile, symlink);

    await expect(sandbox.validatePath('escape')).rejects.toThrow('Symlink escape detected');

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('creates and destroys isolated temp directories', async () => {
    const dir = await SecuritySandbox.createIsolatedTempDir();
    await expect(fs.access(dir)).resolves.toBeUndefined();
    await SecuritySandbox.destroyIsolatedTempDir(dir);
    await expect(fs.access(dir)).rejects.toThrow();
  });
});
