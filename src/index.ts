/* eslint-disable no-console */
import axios from 'axios';
import { Hmac, createHmac } from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import { parse } from 'yaml';
import https from 'https';
import type { Application, Request, Response } from 'express';

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

if (!process.env.PORTAINER_INSECURE) {
  axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });
}

const app: Application = express();
app.use(express.json());

function updateServices(image: string): Promise<void> {
  return new Promise<void>(
    (resolve: (result: void) => void, reject: (error: Error) => void): void => {
      axios
        .get(`${process.env.PORTAINER_URL}/api/stacks`, {
          headers: {
            'X-API-Key': `${process.env.PORTAINER_TOKEN}`,
          },
        })
        .then((stacksRequest: any): void => {
          if (!stacksRequest.data || !stacksRequest.data.length) {
            reject(new Error('NO_STACKS_FOUND'));
            return;
          }
          console.log(stacksRequest.data.map((stack: any): string => stack.Id));
          stacksRequest.data.forEach((stack: any): void => {
            axios
              .get(`${process.env.PORTAINER_URL}/api/stacks/${stack.Id}/file`, {
                headers: {
                  'X-API-Key': `${process.env.PORTAINER_TOKEN}`,
                },
              })
              .then(async (composeRequest: any): Promise<void> => {
                const compose: any = parse(
                  composeRequest.data.StackFileContent,
                );
                let updateService: boolean = false;
                // eslint-disable-next-line no-restricted-syntax
                for await (const service of Object.values(
                  compose.services,
                ) as any[]) {
                  if (
                    service.deploy?.labels?.find((label: string): boolean =>
                      label.startsWith('ghcrhook.update'),
                    ) &&
                    service.image === image
                  ) {
                    console.log(service.image);
                    updateService = true;
                  }
                }
                if (!updateService) {
                  return;
                }
                console.log(
                  `updating stack ${stack.Name} (${stack.Id}) with image ${image}`,
                );
                axios
                  .put(
                    `${process.env.PORTAINER_URL}/api/stacks/${stack.Id}?endpointId=${stack.EndpointId}`,
                    {
                      stackFileContent: composeRequest.data.StackFileContent,
                      env: stack.Env,
                      prune: true,
                      pullImage: true,
                    },
                    {
                      headers: {
                        'X-API-Key': `${process.env.PORTAINER_TOKEN}`,
                      },
                    },
                  )
                  .then((response: any): void => {
                    resolve(response);
                    // TODO: fix that multiple services can be updated at the same time
                  })
                  .catch((error: any): void => {
                    reject(error);
                  });
              })
              .catch((error: any): void => {
                reject(error);
              });
          });
        })
        .catch((error: Error): void => {
          reject(error);
        });
    },
  );
}

app.post('/', async (req: Request, res: Response): Promise<void> => {
  console.log(`received webhook with action ${req.body.action}`);
  if (req.body.action !== 'published') {
    res.status(400).send('IGNORING_INVALID_ACTION');
    console.log(`ignoring invalid action ${req.body.action}`);
    return;
  }
  const reqPackageUrl: string = req.body.package.package_version.package_url;
  if (!reqPackageUrl) {
    res.status(400).send('INVALID_PAYLOAD_MISSING_PACKAGE_URL');
    console.log('ignoring invalid payload, missing package_url');
    return;
  }
  const hmac: Hmac = createHmac('sha256', process.env.SECRET as string);
  const signature: string = `sha256=${hmac.update(JSON.stringify(req.body)).digest('hex')}`;
  if (req.headers['x-hub-signature-256'] !== signature) {
    res.status(400).send('INVALID_SIGNATURE');
    console.log('ignoring invalid signature');
    return;
  }

  updateServices(reqPackageUrl)
    .then((): void => {
      res.status(200).send('OK');
      console.log(`done handling webhook for package ${reqPackageUrl}`);
    })
    .catch((error: Error): void => {
      res.status(500).send('ERROR');
      console.error(error);
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
