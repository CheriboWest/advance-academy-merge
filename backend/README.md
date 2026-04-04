# Backend Structure

This backend uses `Fastify + TypeScript`.

## Command to check
npm run dev:backend
test the api http://localhost:4000/api/health and see if the "status" is "ok"

## Folder Layout

```text
backend/
  src/
    main.ts
    routes/
      system.ts
      cv-optimizer.ts
    services/
      system.service.ts
      cv-optimizer.service.ts
    types/
      cv-optimizer.ts
```
## How To Add A New Feature

For a feature like `auth`, `users`, or `courses`, usually add:

```text
src/
  routes/
    auth.ts
  services/
    auth.service.ts
  types/
    auth.ts
```

Then register it in `src/main.ts` --> define endpoints in `src/routes` + simple handle request/response --> Write logic as functions in `src/services` (folder `src/types` is optional for define type of reponse and request)

## What Each Folder Does

`src/main.ts`

- Starts the Fastify server
- Registers plugins like CORS
- Registers route groups

`src/routes/`

- Contains HTTP route handlers
- Reads request body, params, query, and headers
- Sets HTTP status codes when needed
- Calls service functions to do the real work

`src/services/`

- Contains business logic
- Does calculations and data transformation
- Place for database calls or AI calls

`src/types/`
- Contains TypeScript types and interfaces
- Defines the shape of request or response data

## Current Route Files

`routes/system.ts`
- Handles general backend routes
- `GET /api/health`

## Current Service Files

`services/system.service.ts`
- Returns the health-check response


