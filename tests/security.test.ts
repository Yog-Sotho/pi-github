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
    expect(resolved).toBe(path.join(tempDir, 'safe.txt'));
  });

  it('blocks directory traversal', async () => {
    await expect(sandbox.validatePath('../../../etc/passwd')).rejects.toThrow('Path traversal detected');
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
});