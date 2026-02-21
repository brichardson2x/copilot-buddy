import express, { type Express } from 'express';
import { createWebhookHandler, type OnProcessEvent } from './webhook';

export interface CreateAppOptions {
  onProcessEvent?: OnProcessEvent;
}

export const createApp = (options: CreateAppOptions = {}): Express => {
  const app = express();
  const webhookHandler = createWebhookHandler({ onProcessEvent: options.onProcessEvent });

  app.get('/health', (_req, res) => {
    return res.status(200).json({
      status: 'ok',
      model: process.env.AGENT_MODEL ?? '',
      uptime: process.uptime()
    });
  });

  app.post('/webhook', express.raw({ type: 'application/json' }), webhookHandler);

  return app;
};
