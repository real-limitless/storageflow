# Security

## Reporting a vulnerability

Report a vulnerability privately to the owner. Do not open a public issue that includes exploit detail, proof-of-concept input, or secret material.

## Interim on-call

Owner: Chen. First responder: DevOps.

## Kill switch

An owner disables an account with `POST /admin/users/:id/disable`. That ends the account's sessions. API keys are held by a service account. Disabling that account makes those keys fail closed. There is no separate route that revokes one key.

Take the service offline by stopping the Dokploy deployment. Leave volumes in place. Do not change `APP_ENCRYPTION_KEY`.

On a local development machine, stop the stack with `docker compose stop`. Do not run `docker compose down -v`.
