# Frontend architecture

See [README.md](README.md) for startup and build commands.

`src/App.tsx` defines routes and persistent feature providers. Feature pages load
through `components/shared/ViewBoundary.tsx`. `components/layout/` owns the shell,
navigation, sidebar and shared dialogs. `context/` owns the session provider;
`hooks/` contains viewport, appearance and sidebar behavior.

Each `src/features/` folder owns its pages, forms, state and API calls: account,
auth, chat, feedback, map, reflection and terms. Shared HTTP/session control,
streaming and API errors belong in `src/services/`. Route helpers and password
validation live in `src/utils/`.

The browser calls the backend API; credentials and provider integrations remain
in the backend. Production serves the website and `/api/v1` from one origin.
Vite proxies API requests during development.

`public/` contains active standalone admin/webmail pages, legal documents and
images copied into the build. React global styles live in `src/styles/index.css`.
Tests in `src/test/` cover feature flows, controllers and API contracts. Run
`npm test --prefix frontend-react -- --run` and
`npm run build --prefix frontend-react` after frontend behavior changes.
