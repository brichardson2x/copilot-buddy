import dotenv from 'dotenv';
import { createApp } from './server';

dotenv.config();

const DEFAULT_PORT = 3000;

export { createApp };

if (require.main === module) {
  const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
  const port = Number.isNaN(parsedPort) ? DEFAULT_PORT : parsedPort;

  createApp().listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}
