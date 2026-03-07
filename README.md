# Silent (formerly Doduo)

A Nostr direct messaging client.

## Features

- NIP 04 Direct messaging
- NIP 17 Direct messaging
  - Kind 14: Sending / receving
  - Kind 15: Receiving (with encryption)
- Network state handling with automatic reconnection
- Supports outbox model, preset relays, or hybrid combination
- 10002 (Relay List), 10050 (DM Relay List), and 10006 (Blocked Relay List) NIP 65 relay lists supported
- subjects supported in conversations
- search
  - messages
  - contact names
- shorts

## DMs on Nostr

Other clients supporting NIP17 messages.

| Project | Link | GitHub |
| ------- | ---- | ------ |
| 0xChat | <https://www.0xchat.com/> | <https://github.com/0xchat-app> |
| Amethyst | <https://amethyst.social/> | <https://github.com/vitorpamplona/amethyst> |
| Coop | <https://reya.su/coop/> | <https://github.com/lumehq/coop> |
| Coracle | <https://coracle.social> | <https://github.com/coracle-social/coracle> |
| Flotilla | <https://flotilla.social> | <https://github.com/coracle-social/flotilla> |
| Futr | <https://futrnostr.com/> | <https://github.com/futrnostr/futr> |
| Gossip | ? | <https://github.com/mikedilger/gossip> |
| Keychat | <https://keychat.io> | <https://github.com/keychat-io/keychat-app> |
| Yakihonne | <https://yakihonne.com> | <https://github.com/YakiHonne> |

(PRs welcome for the above list - and anything else)

### related

- <https://github.com/cashubtc/cashu.me>
- <https://github.com/minibits-cash/minibits_wallet>
- <https://www.nutstash.app/>
- <https://github.com/Robosats/robosats>
- <https://github.com/Nostr-Safebox/safebox>

## Getting Started

```bash
npm install
npm run dev
```

## Development

### Docker Development

The project uses Docker for development with automatic package linking (note you can run it without docker, but then without the proxy for decrypting nip17 kind 15s):

```bash
# Start development environment
docker-compose up

# App runs at http://localhost:3000
```

The `nostr-messaging` package is automatically linked and rebuilt on changes. See `DOCKER_SETUP.md` for details.
