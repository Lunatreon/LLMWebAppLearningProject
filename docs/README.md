# Documentation

Start with [Run FeelY](../STARTUP.md) and [the project map](../README.md).

## Understand and change the code

- [Code guide](CODE_GUIDE.md): entry points, request flow, ownership and checks.
- [Project structure review](PROJECT_STRUCTURE_REVIEW.md): active files, optional tools and overhead.
- [Backend structure](BACKEND_STRUCTURE.md) and [LLM internals](../backend/llm/README.md).
- [Frontend guide](../frontend-react/README.md) and [architecture](../frontend-react/ARCHITECTURE.md).
- [Script index](../scripts/README.md).

## Run and operate

- [Local Docker](DEPLOYMENT_LOCAL.md) or [native installation](DEPLOYMENT_NATIVE.md).
- [Production deployment](DEPLOYMENT_PRODUCTION.md) and [smoke checks](PRODUCTION_SMOKE_TEST.md).
- [Database migrations and transfer](DATABASE_MIGRATION.md); [chat storage](CHAT_STORAGE.md).
- [Security](SECURITY.md), [administration](admin.md), [Stripe](stripe-setup.md).
- [Outbound email](EMAIL_SETUP.md) and [optional inbound webmail](WEBMAIL_SETUP.md).

## Feature references

- [Feature settings and API flows](FEATURES.md).
- [Map and self-authorship](SELF_AUTHORSHIP.md), [topic categories](TOPIC_CATEGORIES.md).
- [Chat controls and free phase](chat-controls-and-free-phase.md).
- [Terms publishing](AGB_SETUP.md), [Android and Terms](ANDROID_AND_TERMS.md).
- [Visual design](BRIGHT_DESIGN.md).

`pattern_recognition.txt` is **runtime input** loaded by the analyser. Keep it
until a separate change updates its loader and Docker copy rules.

## Historical records

[Archive](archive/README.md) contains earlier architecture inventories and Docker
validation evidence. Those records describe their date and are not startup instructions.
The production configuration inventory remains useful for operators and is linked
from the production guide.
