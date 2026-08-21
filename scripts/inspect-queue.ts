import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});

async function main(): Promise<void> {
  const senderId = 'cmt16zq620000kmpl5la6qd62';
  const prefix = `bull:email-${senderId}`;
  const keys = await redis.keys(`${prefix}:*`);
  console.log('Redis keys for queue:', keys);

  const delayed = await redis.zrange(`${prefix}:delayed`, 0, -1, 'WITHSCORES');
  console.log('Delayed jobs (jobId, fireAt):', delayed);

  for (const jobId of delayed) {
    if (jobId.includes(':') || jobId === '0') continue;
    const data = await redis.hgetall(`${prefix}:${jobId}`);
    console.log(`Job ${jobId}:`, { name: data.name, data: data.data });
  }

  const total = await redis.zcard(`${prefix}:delayed`);
  console.log('total delayed:', total);
  redis.disconnect();
}

void main();