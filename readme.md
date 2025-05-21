<p align="center"><a href="#" target="_blank" rel="noopener noreferrer"><img width="100" src="assets/blaze.png" alt="blaze logo"></a></p>

<h1 align="center">Blaze</h1>

<p align="center">
<a href="https://github.com/itmr-dev/blaze" title="Go to GitHub repo"><img src="https://img.shields.io/static/v1?label=itmr-dev&amp;message=blaze&amp;color=blue&amp;logo=github" alt="itmr-dev - blaze"></a>
<a href="https://github.com/itmr-dev/blaze/actions?query=workflow:&quot;prod+ci&quot;"><img src="https://github.com/itmr-dev/blaze/workflows/prod%20ci/badge.svg" alt="prod ci"></a>
<a href="https://github.com/itmr-dev/blaze/issues"><img src="https://img.shields.io/github/issues/itmr-dev/blaze" alt="issues - blaze"></a>
</p>

Blaze is a service designed to automatically update Docker Swarm services based on GitHub package releases. This document explains how to deploy and configure Blaze using Docker Compose.

## Prerequisites

Before setting up Blaze, ensure you have the following:

- Docker Swarm up and running.
- Access to GitHub repositories for receiving webhooks.
- Access to a Portainer instance to manage Docker stacks.
- Environment variables set:
  - `SECRET`: A secret key used for webhook payload verification.
  - `PORTAINER_TOKEN`: Token for accessing the Portainer API.
  - `PORTAINER_URL`: URL of your Portainer instance.

## Setup

1. **Configure Environment Variables in Portainer**:

   - Log in to your Portainer instance.
   - Go to the "Stacks" section.
   - Create a new stack or edit an existing one.
   - In the stack configuration, navigate to the "Environment" section.
   - Add the following environment variables:
     - `SECRET`: Your secret key used for webhook payload verification.
     - `PORTAINER_TOKEN`: Token for accessing the Portainer API.
     - `PORTAINER_URL`: URL of your Portainer instance.

2. **Update Stack Configuration in Portainer**:

   - Copy and paste the following stack configuration into the Compose Editor:

   ```yaml
   version: '3.7'
   services:
     blaze:
       image: 'ghcr.io/itmr-dev/blaze:latest'
       deploy:
         replicas: 1
         update_config:
           delay: 10s
           failure_action: rollback
           order: start-first
         labels:
           - 'blaze.update'
       environment:
         - SECRET=${SECRET}
         - PORTAINER_TOKEN=${PORTAINER_TOKEN}
         - PORTAINER_URL=${PORTAINER_URL}
       networks:
         - portainer_agent_network

   networks:
     portainer_agent_network:
       external: true
   ```

   - Ensure that you replace `${SECRET}`, `${PORTAINER_TOKEN}`, and `${PORTAINER_URL}` with your actual values.

3. **Deploy Blaze**: Deploy the Blaze service by starting or updating the stack in Portainer.

4. **Label Services**: Add the `blaze.update` label to every service you want to automatically update when a new package is released.

## How It Works

1. Blaze listens for incoming webhooks from GitHub.
2. When a webhook is received, Blaze verifies the payload signature using the provided secret.
3. If the webhook action is 'published', Blaze proceeds to extract the package URL from the payload.
4. Blaze queries the Docker Swarm for running stacks.
5. For each stack found, Blaze checks if there are services with the label 'blaze.update' and matching the released package URL.
6. If matches are found, Blaze updates the corresponding stacks with the new package.
7. Blaze responds to GitHub with the status of the update process.

---

## Blaze Service with Traefik

<details>
<summary>Click to expand: Setup with Traefik</summary>

---

### Setup with Traefik

Extend your Docker Compose file to include Traefik configuration for routing and SSL termination:

```yaml
version: '3.7'
services:
  hooks:
    image: 'ghcr.io/itmr-dev/blaze:latest'
    deploy:
      replicas: 1
      update_config:
        delay: 10s
        failure_action: rollback
        order: start-first
      labels:
        - 'traefik.enable=true'
        - 'traefik.http.routers.blaze.rule=Host(`blaze.example.com`)'
        - 'traefik.http.routers.blaze.entrypoints=https'
        - 'traefik.http.routers.blaze.tls=true'
        - 'traefik.http.services.blaze.loadbalancer.server.port=80'
        - 'blaze.update'
    environment:
      - SECRET=${SECRET}
      - PORTAINER_TOKEN=${PORTAINER_TOKEN}
      - PORTAINER_URL=${PORTAINER_URL}
    networks:
      - proxy
      - portainer_agent_network

networks:
  proxy:
    external: true
  portainer_agent_network:
    external: true
```

Replace `blaze.example.com` with your desired domain name for accessing Blaze. Ensure that Traefik is properly configured to handle HTTPS requests and route them to the Blaze service.

---

</details>

---

Choose the appropriate setup based on your infrastructure requirements. If you encounter any issues or have further questions, please refer to the [GitHub repository](https://github.com/itmr-dev/blaze) or reach out to the maintainers.
