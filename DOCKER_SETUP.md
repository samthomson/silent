# Docker Development Setup

## Two Development Modes

### 1. Normal Development (Just Relayed Chat)

For developers working only on Relayed Chat (not the messaging package):

```bash
npm install  # Fetches @nostr-dm/messaging from npm/git
npm run dev  # Standard Vite dev server
```

The package is a normal dependency in `package.json`.

### 2. Package Development (Relayed Chat + Messaging)

For developers working on both Relayed Chat and the messaging package:

```bash
docker-compose up
```

**How it works:**

1. **messaging-builder** container:
   - Mounts: `../nostr-messaging`
   - Runs: `npm run dev` (watch mode)
   - Rebuilds on file changes

2. **app** container:
   - Mounts: `.` (Relayed Chat) and `../nostr-messaging`
   - Environment: `DOCKER_DEV=true`
   - Postinstall creates symlink: `node_modules/@nostr-dm/messaging` → `/nostr-messaging`
   - Overrides the npm-installed package with local development version

**Workflow:**
```bash
# Edit files in ~/code/nostr-messaging/src/
# → messaging-builder auto-rebuilds
# → Relayed Chat's Vite picks up changes
# → Browser hot-reloads
```

### Requirements

- For package development: `nostr-messaging` and `silent` must be sibling directories
- For normal development: Just `npm install`
