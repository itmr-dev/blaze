/* eslint-disable no-console */
import axios from 'axios';
import { Hmac, createHmac } from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { parse } from 'yaml';
import https from 'https';
import type { Application, Request, Response } from 'express';
import favicon from 'serve-favicon';
import path from 'path';

dotenv.config();

if (!process.env.SECRET) {
  throw new Error('SECRET not set');
}
if (!process.env.PORTAINER_URL) {
  throw new Error('PORTAINER_URL not set');
}
if (!process.env.PORTAINER_TOKEN) {
  throw new Error('PORTAINER_TOKEN not set');
}
axios.defaults.headers.common['X-API-Key'] = process.env.PORTAINER_TOKEN;

if (!process.env.PORTAINER_INSECURE) {
  axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });
}

const app: Application = express();
app.use(cors());
app.use(express.json());
app.disable('x-powered-by');
app.use((_req: Request, res: Response, next: () => void): void => {
  res.setHeader('X-Powered-By', 'Blaze');
  next();
});
app.use(favicon(path.join(__dirname, '..', 'assets', 'favicon.ico')));

let hookCount: number = 0;

function getStacks(): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>(
    (
      resolve: (result: Record<string, unknown>) => void,
      reject: (error: Error) => void,
    ): void => {
      axios
        .get(new URL('/api/stacks', process.env.PORTAINER_URL).href)
        .then((stacksRequest: any): void => {
          if (!stacksRequest.data || !stacksRequest.data.length) {
            reject(new Error('NO_STACKS_FOUND'));
            return;
          }
          resolve(stacksRequest.data);
        })
        .catch((error: Error): void => {
          reject(error);
        });
    },
  );
}

function getStackFile(id: string): Promise<string> {
  return new Promise<string>(
    (
      resolve: (result: string) => void,
      reject: (error: Error) => void,
    ): void => {
      axios
        .get(new URL(`/api/stacks/${id}/file`, process.env.PORTAINER_URL).href)
        .then((stackFileRequest: any): void => {
          if (
            !stackFileRequest.data ||
            !stackFileRequest.data.StackFileContent
          ) {
            reject(new Error('NO_STACK_FILE_FOUND'));
            return;
          }
          resolve(stackFileRequest.data.StackFileContent);
        })
        .catch((error: Error): void => {
          reject(error);
        });
    },
  );
}

function updateStack(stackUpdate: Record<string, any>): Promise<void> {
  return new Promise<void>(
    (resolve: (result: void) => void, reject: (error: Error) => void): void => {
      axios
        .put(
          new URL(
            `/api/stacks/${stackUpdate.stack.Id}?endpointId=${stackUpdate.stack.EndpointId}`,
            process.env.PORTAINER_URL,
          ).href,
          {
            stackFileContent: stackUpdate.compose,
            env: stackUpdate.stack.Env,
            prune: true,
            pullImage: true,
          },
        )
        .then((response: any): void => {
          resolve(response);
        })
        .catch((error: any): void => {
          reject(error);
        });
    },
  );
}

// adding a health check endpoint
app.get('/health', (_req: Request, res: Response): void => {
  res.status(200).send('OK');
});

app.post('/', async (req: Request, res: Response): Promise<void> => {
  hookCount += 1;
  const hookId: number = hookCount;

  console.log(`[#${hookId}] received webhook with action ${req.body.action}`);
  if (req.body.action !== 'published') {
    res.status(400).send('IGNORING_INVALID_ACTION');
    console.log(`[#${hookId}] ignoring invalid action ${req.body.action}`);
    return;
  }
  const reqPackageUrl: string = req.body.package.package_version.package_url;
  if (!reqPackageUrl) {
    res.status(400).send('INVALID_PAYLOAD_MISSING_PACKAGE_URL');
    console.log(`[#${hookId}] ignoring invalid payload, missing package_url`);
    return;
  }
  const hmac: Hmac = createHmac('sha256', process.env.SECRET as string);
  const signature: string = `sha256=${hmac.update(JSON.stringify(req.body)).digest('hex')}`;
  if (req.headers['x-hub-signature-256'] !== signature) {
    res.status(400).send('INVALID_SIGNATURE');
    console.log(`[#${hookId}] ignoring invalid signature`);
    return;
  }

  const stacks: Record<string, unknown> = await getStacks();
  const updatingStacks: Record<string, unknown>[] = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const stack of Object.values(stacks) as any[]) {
    const stackFile: string = await getStackFile(stack.Id);
    const parsedStackFile: any = parse(stackFile);
    let foundService: boolean = false;
    // eslint-disable-next-line no-restricted-syntax
    for await (const service of Object.values(
      parsedStackFile.services,
    ) as any[]) {
      if (
        (service.deploy?.labels?.find((label: string): boolean =>
          label.startsWith('blaze.update'),
        ) ||
          service.labels?.find((label: string): boolean =>
            label.startsWith('blaze.update'),
          )) &&
        service.image === reqPackageUrl
      ) {
        console.log(
          `[#${hookId}] found service in stack ${stack.Name} (${stack.Id})`,
        );
        foundService = true;
      }
    }
    if (foundService) {
      updatingStacks.push({
        stack,
        compose: stackFile,
      });
    }
  }

  if (!updatingStacks.length) {
    res.status(400).send('NO_SERVICE_FOUND_FOR_PACKAGE_URL');
    console.log(
      `[#${hookId}] invalid webhook. no service found for package ${reqPackageUrl}`,
    );
    return;
  }

  console.log(`[#${hookId}] updating ${updatingStacks.length} stacks`);
  // eslint-disable-next-line no-restricted-syntax
  for await (const stackUpdate of updatingStacks) {
    await updateStack(stackUpdate);
  }

  console.log(
    `[#${hookId}] done handling webhook for package ${reqPackageUrl} - updated ${updatingStacks.length} stacks`,
  );
  res
    .status(200)
    .send(
      `done handling webhook for package ${reqPackageUrl} - updated ${updatingStacks.length} stacks`,
    );
});

app.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({
    msg: 'Hi this is Blaze. Ready to receive webhooks. Find out more about Blaze on GitHub.',
    url: 'https://github.com/itmr-dev/blaze',
    time: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    logo: 'https://raw.githubusercontent.com/itmr-dev/blaze/main/assets/blaze.png',
    version: process.env.npm_package_version,
  });
});

app.use((req: Request, res: Response): void => {
  res.status(400).json({
    msg: 'Hi this is Blaze. Ready to receive webhooks.',
    path: req.path,
    method: req.method,
    error: 'page not found',
  });
});

app.listen(process.env.PORT || 80, (): void => {
  console.log(`ready to receive webhooks on port ${process.env.PORT || 80}`);
});

function exit(signal: string): void {
  console.log(`received shutdown signal (${signal}), exiting`);
  process.exit(0);
}
process.on('SIGINT', (): void => exit('SIGINT'));
process.on('SIGTERM', (): void => exit('SIGTERM'));
