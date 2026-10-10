import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createApp } from './app.js';

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log('MongoDB connected');
  const app = createApp();
  const server = app.listen(env.port, () => console.log(`Reliable API on http://localhost:${env.port}`));

  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error('Failed to start:', e.message);
  process.exit(1);
});
