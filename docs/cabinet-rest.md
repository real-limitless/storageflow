# Cabinet REST

These routes are the cabinet API on port 8787. The web app and the `@storageflow/mcp` stdio server both call them. This is not a control API.

8794 stays admin S3. 5179 stays SFTPGo.

The user-facing word is Cabinet. Routes stay `projects`.

## Auth

A person signs in with the `sf_session` cookie from `POST /users`, `POST /sessions`, or `POST /sessions/magic/consume`.

A service account sends `Authorization: Bearer sfk_…`. Scopes are the grant verbs `list`, `download`, `upload`, `delete`, and `reshare`. A missing verb is denied. Service accounts have no password login.

## Team

The tenant is the team. `POST /tenants` with `{ name, slug? }` creates it, inserts an `owner` membership, and points the session at that team. `GET /me` reads the user, memberships, and active team. There is no rename or delete route.

## Cabinet

`GET /projects` lists cabinets in the active team. `POST /projects` creates one (`name`, `kind`). `PATCH /projects/:id` updates it. `DELETE /projects/:id` deletes it.

## Drawer

`GET /projects/:id/drawers` lists drawers. `POST /projects/:id/drawers` creates one (`name`, `mode` of `hosted` or `linked`). `PATCH /drawers/:id` updates it. `DELETE /drawers/:id` deletes it.

## Folder and file

`GET /drawers/:id/list?folderId=` lists folders and files. `POST /drawers/:id/folders` creates a folder (`parentId`, `name`). `PATCH /nodes/:id` renames, stars, or colors a folder or file. `POST /nodes/delete` deletes (`nodeIds`).

A file upload is `POST /drawers/:id/uploads`, then `PUT /uploads/:id/body`, then `POST /uploads/:id/complete`. `GET /nodes/:id/content` reads the bytes.

## MCP

`@storageflow/mcp` exposes the same actions as stdio tools. Start it with `npm run start -w @storageflow/mcp`. Set `STORAGEFLOW_API_URL` (default `http://127.0.0.1:8787`) and either `STORAGEFLOW_SESSION` or `STORAGEFLOW_API_KEY`. Tool names say cabinet. They call the `projects` routes above.
