# lioneyo

## Environment variables

Backend (lioneyo-server):

- `PORT` — port for the backend server (default: `4000`). The server reads `process.env.PORT` in `src/config.js`.
- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, etc. — see `lioneyo-server/src/config.js` for full list.

Frontend (lioneyo-frontend):

- At build time you can set `REACT_APP_BACKEND_URL` to point the frontend to your backend (used by `src/services/api.js`). Example:

```bash
REACT_APP_BACKEND_URL=http://api.example.com npm run build
```

- For runtime configuration (no rebuild required), the frontend loads `public/env.js` which sets `window.__ENV__.REACT_APP_BACKEND_URL`. You can replace `public/env.js` on the server or serve a modified copy to point the deployed frontend to a different backend.
