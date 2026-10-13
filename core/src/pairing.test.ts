import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackend, type Backend } from "./backend";
import { countdown, PairingFlow } from "./pairing.svelte";
import type { Device } from "./types";

function fake(expiresInMs: number, devicesAfter: (n: number) => Device[]) {
  let listed = 0;
  const backend: Backend = {
    async invoke<T>(cmd: string): Promise<T> {
      if (cmd === "list_devices") return devicesAfter(listed++) as T;
      if (cmd === "create_pairing") return { code: "123456", expiresAt: new Date(Date.now() + expiresInMs).toISOString(), url: "https://x.workers.dev/app/" } as T;
      throw `unexpected ${cmd}`;
    },
    listen: async () => () => {},
  };
  useBackend(backend);
}

const device = (id: string, name: string): Device => ({ id, name, createdAt: "", lastSeenAt: null, current: false });

afterEach(() => vi.useRealTimers());

describe("PairingFlow", () => {
  it("notices the new device and hides the code", async () => {
    vi.useFakeTimers();
    fake(300_000, (n) => (n < 2 ? [device("pc", "PC")] : [device("pc", "PC"), device("ip", "iPhone（網頁版）")]));
    const onjoin = vi.fn();
    const flow = new PairingFlow(onjoin);
    await flow.start();
    expect(flow.pairing?.code).toBe("123456");
    expect(flow.left).toBe(300);
    await vi.advanceTimersByTimeAsync(3_000); // 第一次檢查：還沒加入
    expect(flow.joined).toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(flow.joined).toBe("iPhone（網頁版）");
    expect(flow.pairing).toBeNull();
    expect(onjoin).toHaveBeenCalledOnce();
  });

  it("stops counting when the code expires", async () => {
    vi.useFakeTimers();
    fake(2_000, () => []);
    const flow = new PairingFlow();
    await flow.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flow.left).toBe(0);
    expect(flow.pairing).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("formats the countdown", () => {
    expect(countdown(245)).toBe("4:05");
    expect(countdown(0)).toBe("0:00");
  });
});
