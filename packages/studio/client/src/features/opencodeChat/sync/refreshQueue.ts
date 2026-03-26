type RefreshQueueInput = {
  paused: () => boolean;
  refresh: () => Promise<void> | void;
};

export function createRefreshQueue(input: RefreshQueueInput) {
  let pending = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void drain();
    }, 0);
  };

  const refresh = () => {
    pending = true;
    if (input.paused()) return;
    schedule();
  };

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        if (input.paused()) return;
        pending = false;
        await input.refresh();
        await tick();
      }
    } finally {
      running = false;
      if (input.paused()) return;
      if (pending) schedule();
    }
  }

  return {
    refresh,
    dispose() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
