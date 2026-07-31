# Vague tickets (tier C)

Real-world-style tickets: symptoms and product language, little or no code detail.
Use these to test **triage** behavior — not sharp read-first like `fe-new` or `slide-preset`.

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/vague/player-profile-slow.txt \
  --scopes=php,js \
  --non-interactive
```

Expect: broad read-first, low flow-path confidence, agent should verify — not trust ranking blindly.

Run tier-C tests (soft asserts, needs `sqlite/Graph.sqlite`):

```bash
npm run test:ticket-vague-triage
```
