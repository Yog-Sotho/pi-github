import simpleGit, { SimpleGit, CleanOptions } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

export class GitOperations {
  private git: SimpleGit;

  constructor(private cwd: string) {
    this.git = simpleGit(this.cwd, { baseDir: this.cwd });
  }

  async init(): Promise<void> {
    const exists = await fs.access(path.join(this.cwd, '.git')).catch(() => false);
    if (!exists) {
      await this.git.init({ '--initial-branch': 'main' });
    }
  }

  async clone(url: string): Promise<void> {
    await this.git.clone(url, this.cwd, { '--depth': '1' });
  }

  async checkout(branch: string, create = false): Promise<void> {
    if (create) {
      await this.git.checkoutLocalBranch(branch);
    } else {
      await this.git.checkout(branch);
    }
  }

  async status(): Promise<string> {
    const status = await this.git.status();
    return status.files.map(f => f.path).join('\n') || 'clean';
  }

  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message, [], { '--allow-empty': false });
    return result.commit || '';
  }

  async push(branch: string, upstream?: string): Promise<void> {
    await this.git.push('origin', branch, upstream ? { '--set-upstream': true } : {});
  }

  async clean(): Promise<void> {
    await this.git.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);
  }
}