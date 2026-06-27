import Redis from "ioredis";
import logger from "./logger.js";

let redisClient;

// Custom Memory cache fallback class if Redis is unavailable or unconfigured
class MemoryCacheFallback {
  constructor() {
    this.cache = new Map();
    logger.info("Initialized memory-based fallback cache provider");
  }

  async get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiry && entry.expiry < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, mode, duration) {
    let expiry = null;
    if (mode === "EX" && duration) {
      expiry = Date.now() + duration * 1000;
    }
    this.cache.set(key, { value: String(value), expiry });
    return "OK";
  }

  async del(key) {
    return this.cache.delete(key) ? 1 : 0;
  }

  async exists(key) {
    const hasKey = this.cache.has(key);
    if (!hasKey) return 0;
    const entry = this.cache.get(key);
    if (entry.expiry && entry.expiry < Date.now()) {
      this.cache.delete(key);
      return 0;
    }
    return 1;
  }
}

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn("Redis connection failed. Switching to in-memory fallback cache.");
          redisClient = new MemoryCacheFallback();
          return null; // stop retrying
        }
        return Math.min(times * 100, 2000);
      },
    });

    redisClient.on("error", (err) => {
      logger.error(`Redis Error: ${err.message}`);
    });
  } catch (error) {
    logger.warn(`Could not connect to Redis: ${error.message}. Using in-memory fallback.`);
    redisClient = new MemoryCacheFallback();
  }
} else {
  logger.info("No REDIS_URL found. Using in-memory fallback cache.");
  redisClient = new MemoryCacheFallback();
}

export default redisClient;
