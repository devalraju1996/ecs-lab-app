# ECS Lab App

A small Node.js app for practising the full path: **Mac Downloads → GitHub → Docker Hub → Amazon ECS**.
Every feature of the app shows up on its web page, so you can see each part of the ECS task definition working.

| App feature | Task definition section it tests |
|---|---|
| `APP_ENV`, `APP_VERSION`, `APP_COLOR` shown on the page | Environment variables |
| `SECRET_MESSAGE` shown masked | Secrets (Secrets Manager) |
| `GET /health` returns 200 | HealthCheck |
| Every request logged as JSON | Log configuration (CloudWatch) |
| Visit counter saved in `/data/visits.txt` | Volumes + mount points |
| Task ARN, AZ, limits on the page | ECS task metadata (CPU/memory) |
| Clean shutdown on SIGTERM | Stop timeout |

## Files

```
index.js                         the app
package.json                     dependencies (express)
Dockerfile                       node:20-alpine, non-root user, health check
.dockerignore / .gitignore
task-definitions/ecs-lab-ec2.json      EC2 launch type (bridge network)
task-definitions/ecs-lab-fargate.json  Fargate launch type (awsvpc network)
task-definitions/secret-policy.json    IAM inline policy for ecsTaskExecutionRole
```

## Run locally

```bash
docker build -t ecs-lab-app .
docker run -d -p 3000:3000 -e APP_ENV=local -e SECRET_MESSAGE=hello -v lab-data:/data ecs-lab-app
curl localhost:3000/health
```

Open http://localhost:3000 and refresh to see the visit counter go up.

## Endpoints

- `/` – web page with all the details
- `/api/info` – the same details as JSON
- `/health` – health check (`{"status":"ok"}`)

Follow **ECS_Lab_Guide.pdf** for the full step-by-step lab.
