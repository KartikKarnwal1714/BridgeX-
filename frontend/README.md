# BridgeX — API Integration Platform (Frontend)

A resilient multi-protocol API integration and management platform.

Dashboard, Users, APIs & Services, Integrations, Logs, Analytics, API Keys,
Settings, Documentation, and System Health are connected to the BridgeX
backend (see `../backend`) and require login. API keys are stored as hashes;
the full key is shown only once. A `SUPER_ADMIN` must grant a key access to
one or more configured gateway APIs before that key can call them.

## Getting started

1. Make sure the backend is running (see `../backend/README.md`) — the API
   is expected at `http://localhost:5000/api/v1` by default.
2. Copy the env file and adjust if needed:
   ```bash
   cp .env.example .env
   ```
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the app and sign in with a seeded account, e.g.
   `kartik@example.com` / `Password123!` (Super Admin).

## What you can actually do now

- **Users**: Add User (creates a real account), view details, edit
  name/email/role/status, delete (you can't delete your own account)
- **APIs & Services**: Create API, view details, edit any field, delete
- **Integrations**: New Integration, view details, edit, delete
- **API Keys**: Create, copy once, list, revoke and delete keys; a `SUPER_ADMIN`
  can configure limits, expiry and gateway API grants
- **Logs**: Search and browse with cursor pagination
- All changes hit PostgreSQL immediately and the list refreshes — open the
  same page in two tabs to see it.
- Some actions are role-restricted server-side (e.g. only Super Admin can
  create/delete users) — the UI will show the backend's error message if
  you're logged in as a role that isn't allowed to do something.

## Build for production

```bash
npm run build
npm run preview
```

## Project structure

```
src/
├── components/
│   ├── layout/       Sidebar, Header, Layout shell
│   ├── dashboard/     Dashboard-specific cards & charts (data via props)
│   └── common/        Button, Badge, Modal, ConfirmDialog, DataTable,
│                       DataState, etc.
├── context/
│   └── AuthContext.jsx   Login/logout/session state (JWT in localStorage)
├── hooks/
│   └── useApiData.js     Loading/error/refetch wrapper around api calls
├── pages/              One file per route
├── data/mockData.js    Mock data for pages not yet wired to the backend
├── services/api.js     Axios client (JWT header, base URL, 401 handling)
└── routes/
    ├── AppRoutes.jsx
    └── ProtectedRoute.jsx  Redirects to /login when not authenticated
```

## Pages

Dashboard · APIs & Services · Integrations · Logs · Analytics · Users ·
API Keys · Settings · Documentation · System Health

## Connecting more pages to the backend later

Follow the Create/Edit/Delete pattern used in `Users.jsx` / `APIsServices.jsx`
/ `Integrations.jsx`:

1. Write a small async fetcher that calls `api.get(...)` and returns
   `res.data.data`. Call it with `useApiData(fetcher)` for
   `{ data, loading, error, refetch }`.
2. Track `modalMode` (`'create' | 'edit' | 'view' | null`) and a `form`
   object in state; open a shared `<Modal>` for all three, disabling
   inputs when `modalMode === 'view'`.
3. On submit, call `api.post(...)` or `api.put(...)`, then `refetch()`.
4. For delete, track a `deleteTarget` and use `<ConfirmDialog>`, then call
   `api.delete(...)` and `refetch()`.
5. Render `<LoadingState />`, `<ErrorState onRetry={refetch} />`, or
   `<EmptyDataState />` from `components/common/DataState.jsx` around the
   real content.

No layout, styling, or routing changes are required.
