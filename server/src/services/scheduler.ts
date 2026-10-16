/**
 * Tiny in-process scheduler with jitter. No external deps; the VM is ours alone,
 * so setInterval + a startup catch-up run is sufficient.
 */

type Task = () => Promise<void> | void;

const handles: NodeJS.Timeout[] = [];

export function scheduleEvery(name: string, ms: number, task: Task) {
  const run = async () => {
    try {
      await task();
    } catch (e) {
      console.error(JSON.stringify({ level: "error", task: name, error: String(e) }));
    }
  };
  // jitter start 1-5s to avoid thundering on boot
  const jitter = 1000 + Math.random() * 4000;
  const h = setInterval(run, ms);
  handles.push(h);
  setTimeout(run, jitter);
  return h;
}

export function scheduleDaily(name: string, hourUtc: number, task: Task) {
  const computeDelay = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  };
  const tick = async () => {
    try {
      await task();
    } catch (e) {
      console.error(JSON.stringify({ level: "error", task: name, error: String(e) }));
    }
    setTimeout(tick, computeDelay());
  };
  setTimeout(tick, computeDelay());
}

export function stopAll() {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
}
