import asyncio
import time
import logging
from typing import Dict, List, Tuple
import redis.asyncio as aioredis
from app.core.config import settings

logger = logging.getLogger("ledger_vault.rate_limiter")

class RateLimiter:
    def __init__(self):
        self.redis_client = None
        self._loop = None
        self._in_memory_store: Dict[str, List[float]] = {}
        self._warned_redis = False

    def reset(self):
        self._in_memory_store.clear()
        self.redis_client = None
        self._loop = None

    async def get_redis(self):
        try:
            current_loop = asyncio.get_running_loop()
            if self.redis_client is not None and self._loop is not current_loop:
                self.redis_client = None
        except RuntimeError:
            return None

        if self.redis_client is None and not self._warned_redis:
            try:
                client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
                await client.ping()
                self.redis_client = client
                self._loop = current_loop
                logger.info("Connected to Redis for rate limiting.")
            except Exception as e:
                logger.warning(
                    f"Warning: Redis rate limiting unavailable ({e}). Falling back to in-memory rate limiter in dev mode."
                )
                self._warned_redis = True
                self.redis_client = None
        return self.redis_client

    async def is_rate_limited(self, key: str, max_requests: int, window_seconds: int) -> Tuple[bool, int]:
        """
        Check if an operation identified by `key` exceeds `max_requests` in `window_seconds`.
        Returns: (is_limited: bool, retry_after_seconds: int)
        """
        now = time.time()
        redis = await self.get_redis()

        if redis:
            try:
                # Sliding log in Redis via ZSET
                pipe = redis.pipeline()
                pipe.zremrangebyscore(key, 0, now - window_seconds)
                pipe.zcard(key)
                pipe.zadd(key, {str(now): now})
                pipe.expire(key, window_seconds)
                _, count, _, _ = await pipe.execute()

                if count >= max_requests:
                    return True, window_seconds
                return False, 0
            except Exception as e:
                logger.warning(f"Redis rate limit query failed ({e}), falling back to memory.")

        # In-memory sliding log fallback
        timestamps = self._in_memory_store.get(key, [])
        valid_timestamps = [ts for ts in timestamps if ts > (now - window_seconds)]
        
        if len(valid_timestamps) >= max_requests:
            oldest = valid_timestamps[0]
            retry_after = int(oldest + window_seconds - now) + 1
            self._in_memory_store[key] = valid_timestamps
            return True, max(1, retry_after)
        
        valid_timestamps.append(now)
        self._in_memory_store[key] = valid_timestamps
        return False, 0

    async def check_cooldown(self, key: str, cooldown_seconds: int) -> Tuple[bool, int]:
        """
        Check if an action is within cooldown period (e.g. 60s resend).
        Returns: (is_in_cooldown: bool, remaining_seconds: int)
        """
        now = time.time()
        cooldown_key = f"cooldown:{key}"
        redis = await self.get_redis()

        if redis:
            try:
                ttl = await redis.ttl(cooldown_key)
                if ttl > 0:
                    return True, ttl
                await redis.set(cooldown_key, str(now), ex=cooldown_seconds)
                return False, 0
            except Exception as e:
                logger.warning(f"Redis cooldown query failed ({e}), falling back to memory.")

        last_time = self._in_memory_store.get(cooldown_key, [0])[0]
        elapsed = now - last_time
        if elapsed < cooldown_seconds:
            return True, int(cooldown_seconds - elapsed) + 1
        
        self._in_memory_store[cooldown_key] = [now]
        return False, 0

rate_limiter = RateLimiter()
