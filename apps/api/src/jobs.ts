export class JobQueue {
  private tasks: Array<() => Promise<void>> = [];
  private pumping: Promise<void> | null = null;

  enqueue(task: () => Promise<void>): void {
    this.tasks.push(task);
    if (!this.pumping) this.pumping = this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (this.tasks.length) {
        const task = this.tasks.shift();
        if (!task) continue;
        try {
          await task();
        } catch (error) {
          console.error(error);
        }
      }
    } finally {
      this.pumping = null;
      if (this.tasks.length) this.pumping = this.pump();
    }
  }

  whenIdle(): Promise<void> {
    return this.pumping ?? Promise.resolve();
  }
}
