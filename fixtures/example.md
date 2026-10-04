# Authentication design chat

## User

We need an authentication design for a local-first desktop application.

## Assistant

Use OAuth 2.1 with PKCE. Store refresh tokens in the operating-system credential store, not in project files.

## User

What is the decision we should preserve?

## Assistant

The application uses OAuth with PKCE and a credential-store backed token cache.
