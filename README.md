# Doduo

Private messaging on Nostr, inspired by Signal.

## Features

- **End-to-End Encrypted**: Military-grade NIP-44 encryption ensures only you and your contacts can read messages
- **Metadata Private**: Gift-wrapped messages (NIP-17) hide sender identity and timestamps from relays
- **Decentralized**: No central servers. Your keys, your data, your freedom
- **Real-time**: Instant message delivery with WebSocket subscriptions
- **Offline-First**: Messages cached locally with IndexedDB for instant loading
- **File Sharing**: Send encrypted files and images via Blossom servers

## Technology Stack

- **React 18** with TypeScript
- **Nostr Protocol** (NIP-04 & NIP-17 for messaging)
- **Nostrify** for Nostr integration
- **TailwindCSS** for styling
- **shadcn/ui** for beautiful components
- **Vite** for fast builds

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Usage

1. **Login**: Click "Log in" and connect with your Nostr extension (nos2x, Alby, etc.)
2. **Start Chatting**: Click the + button to start a new conversation with any npub
3. **Send Messages**: Type your message and hit Enter or click Send
4. **Share Files**: Click the paperclip icon to attach images or files

## Privacy & Security

Doduo uses NIP-17 for maximum privacy:

- **NIP-44 Encryption**: Modern authenticated encryption for message content
- **Gift Wrapping**: Messages are wrapped in ephemeral keys to hide sender identity
- **Randomized Timestamps**: Send times are randomized ±2 days to prevent timing analysis
- **Local Encryption**: Messages stored locally are encrypted with your NIP-44 key

## Protocol Support

- **NIP-04**: Legacy encrypted direct messages (backwards compatibility)
- **NIP-17**: Modern private messages with gift wrapping (default)
- **NIP-44**: Authenticated encryption
- **NIP-59**: Gift wrap events for metadata privacy

## License

MIT

## Built With

Vibed with [MKStack](https://soapbox.pub/mkstack)
