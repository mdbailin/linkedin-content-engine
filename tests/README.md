# Test requirements

Claude should replace this file with tests during implementation.

Minimum coverage:

1. `loadConfig` defaults and validation.
2. Buffer queue rejects `approved=false`.
3. Buffer schedule rejects missing `dueAt`.
4. Buffer draft path never uses a publishing mode.
5. Buffer document asset serializer contains URL, thumbnail URL, and title.
6. Carousel builder preserves slide ordering.
7. Dry-run end-to-end fixture uses `samples/post-brief.example.json` without external API calls.
