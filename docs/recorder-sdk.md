# Recorder SDK

The Recorder SDK is for applications that already control their own API calls. It does not capture consumer ChatGPT, Claude, or Gemini UIs; it records only the text supplied directly to it by the host application.

```js
import { ConversationRecorder } from "./src/sdk/recorder.js";

const recorder = new ConversationRecorder();
recorder.record({ role: "user", content: "Design an auth flow." });
recorder.record({ role: "assistant", content: "Use OAuth with PKCE." });
const portable = recorder.toNormalizedImport("Auth design");
```

Write `portable` to a local file, inspect it, then use `context-ledger import-json`. The recorder accepts only explicit text/roles, has per-message and total-message limits, makes no network requests, and does not accept credentials.

## Adapter registry

`plugins/registry.json` is a discovery registry, not executable plugin code. A manifest can only declare that it produces the strict normalized import format. Context Ledger never dynamically imports, installs, or executes an adapter from this registry. Provider-specific parser contributions must follow [the adapter contract](adapter-contract.md).
