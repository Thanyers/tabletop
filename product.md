# Tabletop — Product

## Why

**Brand belief:** “The best tool is the one you don't have to think about.” This is why Tabletop should exist: people should be able to return their attention to the work, learning, or play that brought them here.

**Bridge:** “You came here to do something. Not to build the tools to do it.”

**Product thesis:** “Work defines what software becomes.” This is how Tabletop differs: its tables, rules, and useful actions take shape around the work and can change as the work changes. The belief is the reason; the thesis is the product principle.

## Narrative and voice

The hero may open with the Brand Belief and a simple invitation. Develop the body of the public story in this order: **Human → Frustration → Belief → Tabletop → Real Experience → Proof**. Keep the voice warm, tactile, quietly confident, human, and a little poetic while grounded in real work. Keep public copy provider-neutral and supported by product evidence. The working Canvas stays free of slogans: use concise, task-focused labels and guidance there.

## Who

Tabletop is for people working together when fixed software leaves them stitching files, messages, and rules together by hand. Three lenses make that audience concrete:

- **Your Table:** a person or team examining invoices and evidence, then changing what they need to inspect without losing the work already done.
- **A Table for Learning:** a teacher and learner finding different ways to understand one idea through words, values, experiments, and visuals.
- **Our Tables:** friends or groups sharing a world, playing together, and shaping its rules as the story unfolds.

## Where

The table is a shared workspace people can return to. Files, records, rules, actions, and people meet on one Canvas; the work gives those pieces their purpose. A document may be where work begins, but Tabletop's purpose is to give people a place to continue doing that work together.

## Scope

### Product direction

Over time, useful interfaces, rules, and connections should grow from what people are doing. People remain able to inspect, change, and approve what becomes part of their shared work. This direction does not promise that a prompt can generate any interface or application.

### Current beta

Today, a table owner can bring supported text files to a shared table, ask for bounded data and rule proposals, inspect them, and use them after the review and approval steps. Participants act through supported table controls; the server checks permissions and rules. Source-file consent, private owner drafts, and shared active records follow the current contracts in [Generic table design](docs/GENERIC_TABLE_DESIGN.md).

The public demos cover Invoice, Physics, and cooperative Encounter. They use prepared scenarios with deterministic behavior and make no AI provider call. The Helpdesk acceptance run demonstrates a file-based table created and reviewed in a local test environment; see [Calm Canvas acceptance](docs/CALM_CANVAS_ACCEPTANCE.md). Current URLs, release source, and evidence live in [Deployments](docs/DEPLOYMENTS.md).

### Outside the current beta

- Arbitrary interface generation, generated code execution, or a general-purpose application builder.
- Unreviewed changes to shared rules or automatic play on a person's behalf.
- A complete D&D rules engine or automatic long-term campaign memory.

Supported formats, limits, recovery behavior, and acceptance boundaries are maintained in the linked design, acceptance, and deployment records rather than duplicated here.

## Current direction

Keep the public story about people and what they want to do; keep the working Canvas quiet and task-focused. Help a new person begin from their intent, then show what the current beta can do through real interaction and evidence. Read [README](README.md) for the public story and [Calm Canvas design](docs/CALM_CANVAS_DESIGN.md) for its visual and interaction expression.

## Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-20 | Keep the Brand Belief and Product Thesis as distinct statements; use the bridge to connect them. | The belief explains why Tabletop exists; the thesis guides how its software takes shape around work. |
