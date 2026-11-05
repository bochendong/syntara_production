# ascii-sharks

Vendored from https://github.com/stackedlol/ascii-sharks at commit
`a0074c16a106f0abc665fe9712ca445f8f98ad8e` (MIT, copyright 2026 drewdi).
The full license is in `LICENSE` and ships in every web/native build at
`public/licenses/ascii-sharks.txt`. The engine also retains a source license comment. There are no added runtime dependencies or remote assets.

Local adaptations:

- Formatting follows the host repository.
- The engine is decorative: no global pointer handlers or click splashes.
- Animation pauses on document visibility changes, zero-size containers and
  intersection changes, and is capped at 30 frames per second and 1.5 device pixels.
- Reduced motion renders a still scene. Teardown removes observers and listeners.

`ChatOcean.tsx` lazily imports the engine only when the background is enabled.
CSS converts its black ocean to a muted light scene and keeps it behind the chat.
