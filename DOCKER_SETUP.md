# Docker Development Setup

## Two Development Modes

### 1. Normal Development (Just Silent)

For developers working only on Silent (not the messaging package):

```bash
npm install  # Fetches @nostr-dm/messaging from npm/git
npm run dev  # Standard Vite dev server
```

The package is a normal dependency in `package.json`.

### 2. Package Development (Silent + Messaging)

For developers working on both Silent and the messaging package:

```bash
docker-compose up
```

**How it works:**

1. **messaging-builder** container:
   - Mounts: `../nostr-messaging`
   - Runs: `npm run dev` (watch mode)
   - Rebuilds on file changes

2. **app** container:
   - Mounts: `.` (Silent) and `../nostr-messaging`
   - Environment: `DOCKER_DEV=true`
   - Postinstall creates symlink: `node_modules/@nostr-dm/messaging` → `/nostr-messaging`
   - Overrides the npm-installed package with local development version

**Workflow:**
```bash
# Edit files in ~/code/nostr-messaging/src/
# → messaging-builder auto-rebuilds
# → Silent's Vite picks up changes
# → Browser hot-reloads
```

### Requirements

- For package development: `nostr-messaging` and `silent` must be sibling directories
- For normal development: Just `npm install`
