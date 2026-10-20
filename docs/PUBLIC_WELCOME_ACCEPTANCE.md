# Public welcome — 20 October 2026

The anonymous entry page explains why Tabletop exists: tools should take shape around what people are doing. It introduces work, learning, and shared play, then describes the current beta and links to prepared demos. The authenticated chooser and Canvas retain their existing copy and controls.

## Scope

- `AccountSignIn` renders the public page around the existing Google link, invitation notice, error dismissal, retry, and Auto demo link.
- The Remotion GIF illustrates the concept; its caption distinguishes it from runtime evidence. Reduced motion starts with the still poster, with explicit replay and stop controls. The two lower screenshots come from prepared Physics and Encounter demos.
- The page describes supported text files, reviewed rules, shared tables, and returning with the same account. Prepared demos use simulated participants and make no AI calls.
- No auth, room, rule, action, storage, schema, secret, binding, or budget change is included. `AccountBadge` and the remaining account module are byte-identical to the base revision.

## Verification

Local typecheck, production build, Worker dry bundle, and whitespace checks passed. Independent read-only source review found no blocker.

Manual browser checks on an anonymous disposable local Worker passed: desktop layout; actual 390×844 CSS viewport with no horizontal overflow; sign-in anchor; reduced-motion poster and keyboard replay/stop; pending-invitation notice; sign-in failure, dismissal, and retry. The fixture blocks external services and uses synthetic OAuth configuration. No Google or AI call was made during these manual checks.

The Workers browser suite adds anonymous identity/session/OAuth/room count checks, mobile navigation, motion controls, preserved login/demo destinations, and absence of the public page after authentication. Its existing invite, multiplayer, AI-fixture, and room acceptance cases remain in place. [Full CI passed](https://github.com/Thanyers/tabletop/actions/runs/39373019632); the merged source tree is identical to that reviewed candidate.

Staging and production now serve `524d9cc` from the same sealed build; all 135 served assets match. Live anonymous production checks passed at 1280×900 and 390×844, with the original Google destination, concept page, still image, no Canvas, and no horizontal overflow. Existing authenticated browsers in both environments retain the quiet chooser and their unchanged room state. See [Deployments](DEPLOYMENTS.md) for Worker versions and the bounded runtime checks.

SKIPPED: a new real Google sign-in, new real-provider AI run, physical touch-device test, full screen-reader/contrast audit, and load or recovery testing. Existing authenticated browsers can verify the quiet workspace without creating rooms or changing their state.
