import { describe, expect, it, vi } from "vitest";
import { createSerialChannelReplacer } from "../realtime-channel-replacer";

type FakeChannel = {
  topic: string;
  subscribed: boolean;
  on: () => FakeChannel;
  subscribe: () => FakeChannel;
};

describe("Realtime channel replacement", () => {
  it("removes a subscribed topic before configuring its replacement", async () => {
    const channels: FakeChannel[] = [];
    const channel = (topic: string): FakeChannel => {
      const existing = channels.find((candidate) => candidate.topic === topic);
      if (existing) return existing;
      const next: FakeChannel = {
        topic,
        subscribed: false,
        on() {
          if (this.subscribed) throw new Error("listeners added after subscribe");
          return this;
        },
        subscribe() {
          this.subscribed = true;
          return this;
        },
      };
      channels.push(next);
      return next;
    };
    const remove = vi.fn(async (target: FakeChannel) => {
      await Promise.resolve();
      channels.splice(channels.indexOf(target), 1);
    });
    const replacer = createSerialChannelReplacer({ remove });
    const install = () => {
      const next = channel("pos-live-settings");
      next.on().subscribe();
      return next;
    };

    await replacer.replace(install);
    await expect(replacer.replace(install)).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
    expect(channels[0]?.subscribed).toBe(true);
  });

  it("coalesces rapid auth transitions to the latest requested channel", async () => {
    const installed: string[] = [];
    const replacer = createSerialChannelReplacer<string>({
      remove: async () => undefined,
    });

    const first = replacer.replace(() => {
      installed.push("anonymous");
      return "anonymous";
    });
    const second = replacer.replace(() => {
      installed.push("staff");
      return "staff";
    });
    await Promise.all([first, second]);

    expect(installed).toEqual(["staff"]);
  });
});
