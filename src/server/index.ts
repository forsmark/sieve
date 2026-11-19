import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { config } from './config';
import { sqlite } from './kernel/db';
import { log } from './kernel/logger';
import { pruneDoneTasks, recoverRunningTasks, startWorker, stopWorker } from './kernel/tasks';
import { registerEnrichHandler, registerLivenessHandler, queueLivenessChecks } from './ingestion/enrich';
import { startHealthProbe, stopHealthProbe } from './llm';
import { registerMatchingHandlers } from './matching/handlers';
import { registerNotifyHandler } from './notifications/service';
import { recoverPendingLetters, registerCoverLetterHandler } from './letters/service';
import { recoverPendingAnalyses, registerMatchAnalysisHandler } from './analysis/service';
import { registerDeriveHandler } from './profile/derive';
import { markInterruptedRuns } from './sources/runner';
import { startScheduleTimer, stopScheduleTimer } from './sources/schedule';
import { createApp } from './http/app';
import { backupIfDue } from './http/backup';

// Work that was active when the process stopped returns to the queue.
const recovered = recoverRunningTasks();
markInterruptedRuns();
if (recovered > 0) log('info', `returned ${recovered} interrupted tasks to the queue`);

registerEnrichHandler();
registerLivenessHandler();
registerMatchingHandlers();
registerDeriveHandler();
registerNotifyHandler();
registerCoverLetterHandler();
recoverPendingLetters();
registerMatchAnalysisHandler();
recoverPendingAnalyses();

const app = createApp({ clientDir: resolve('dist/client') });
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log('info', `sieve listens on http://${info.address}:${info.port}`);
  if (config.edgeAllowedUser) {
    log('info', `only the gateway user ${JSON.stringify(config.edgeAllowedUser)} is let in`);
  } else if (!config.authPassword) {
    const local = config.host === '127.0.0.1' || config.host === 'localhost' || config.host === '::1';
    log(local ? 'info' : 'warn', local
      ? 'no AUTH_PASSWORD is set, so the server accepts only local connections'
      : `no AUTH_PASSWORD is set and HOST is ${config.host}: every machine that can reach this port has full access`);
  }
});

startWorker();
startHealthProbe();
startScheduleTimer();

const HOUR = 3_600_000;
const maintenance = setInterval(() => {
  queueLivenessChecks();
  pruneDoneTasks();
  void backupIfDue();
}, HOUR);
maintenance.unref();
setTimeout(() => {
  queueLivenessChecks();
  void backupIfDue();
}, 60_000).unref();

function shutdown(): void {
  clearInterval(maintenance);
  stopScheduleTimer();
  stopHealthProbe();
  stopWorker();
  server.close();
  sqlite.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
