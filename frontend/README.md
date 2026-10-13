# Frontend

React/Vite frontend for the active Hisbenew ERP.

## Main folders

- `src/pages/`: route-level ERP screens.
- `src/components/`: shared UI components.
- `src/hooks/`: reusable React hooks.
- `src/utils/`: pure helpers, formatting, parsing, shared utilities.
- `src/api/`: API clients and realtime connection helpers.
- `src/school/`: legacy school ERP UI module.

## Rule for new frontend work

Keep route pages focused on screen composition. Move repeated logic into hooks, repeated UI into components, and pure helper code into utils.

Run from this folder with:

```powershell
npm run dev
```

Build check:

```powershell
npm run build
```