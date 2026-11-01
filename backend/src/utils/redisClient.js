import { createClient } from "redis";

let client;
let connectPromise;

export const getRedisClient = async () => {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not configured");
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", () => console.error("Redis connection error"));
    connectPromise = client.connect().catch((error) => {
      // Do not retain a permanently rejected promise after an initial outage.
      const failedClient = client;
      client = undefined;
      connectPromise = undefined;
      if (failedClient?.isOpen) failedClient.disconnect().catch(() => {});
      throw error;
    });
  }
  await connectPromise;
  return client;
};

export const closeRedisClient = async () => {
  if (!client) return;
  try {
    await connectPromise;
    if (client.isOpen) await client.quit();
  } finally {
    client = undefined;
    connectPromise = undefined;
  }
};
