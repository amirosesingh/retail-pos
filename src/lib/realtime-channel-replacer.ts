type ChannelReplacerOptions<Channel> = {
  remove: (channel: Channel) => Promise<unknown>;
  onCurrentChange?: (channel: Channel | null) => void;
  onError?: (error: unknown) => void;
};

/**
 * Replace a named Realtime channel without overlapping remove/create calls.
 *
 * Supabase reuses an existing channel for the same topic. A replacement must
 * therefore finish removing the joined channel before asking for that topic
 * again, otherwise listeners are added to an already-subscribed instance.
 */
export function createSerialChannelReplacer<Channel>({
  remove,
  onCurrentChange = () => undefined,
  onError = () => undefined,
}: ChannelReplacerOptions<Channel>) {
  let current: Channel | null = null;
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  const schedule = (create?: () => Channel): Promise<void> => {
    const requestedGeneration = ++generation;
    queue = queue
      .catch(onError)
      .then(async () => {
        if (requestedGeneration !== generation) return;

        const previous = current;
        current = null;
        onCurrentChange(null);
        if (previous) await remove(previous);

        if (requestedGeneration !== generation || !create) return;
        const next = create();
        current = next;
        onCurrentChange(next);
      })
      .catch(onError);
    return queue;
  };

  return {
    replace(create: () => Channel): Promise<void> {
      return schedule(create);
    },
    stop(): Promise<void> {
      return schedule();
    },
    idle(): Promise<void> {
      return queue;
    },
  };
}
