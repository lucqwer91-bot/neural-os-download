# NEURAL OS

## Product Concept, Functional Specification & Development Handoff

**Version:** 1.4 --- 16 November 2026\
**Document purpose:** Master handoff for Claude Code, which will build
the entire application.

### Changes in 1.4

- New core story: **NEURAL OS is your AI's long-term memory.** Five
  signature features carry it (section 5.12): AI change log, the
  self-writing memory (session notes), context on request with the
  memory flash, shareable brains, and the brain time-lapse.
- NEURAL OS may now **answer** requests from Claude through a local,
  read-only MCP server (section 3.5). It still never gives Claude tasks.
- New section 4.7: how people discover these features (feature videos,
  one-time hints) and how the product spreads (shared clips and brains,
  launch videos; no website).
- Added to 5.10: stream overlay for OBS (12), stale-note warning (13),
  optional daily recap (14).
- Roadmap updated (section 15).

### Changes in 1.3

- The user's vault is about 80 GB, used for Roblox game development,
  and is edited continuously by Claude. It is therefore **linked in
  place** (read-only, watched), not copied (sections 5.1, 9.3).
- Vault linking moved into Phase 2, so NEURAL OS is useful from the
  first milestone.
- The user has a Mac and tests on both platforms.
- Goal: public release if the app is good. Release requirements added
  (section 15, Phase 7).
- Hooks must be silent so monitoring costs Claude no tokens (section
  6.3). Using the app costs no tokens (section 13.1).
- Honest comparison with Obsidian and fixes for the weak points
  (section 5.11): focus mode, local graph, power saving, Obsidian-flavored
  Markdown compatibility, optional editing of linked folders with
  conflict detection, recording/privacy mode.
- Review fixes: consistent region names, Memory overlay, configuration
  exceptions, data entities, phase numbers.

### Changes in 1.2

- The core idea is unchanged: Claude works, NEURAL OS visualizes and
  organizes, the user stays in control.
- NEURAL OS now **replaces Obsidian** for the user. It has its own
  Markdown editor and note features, and does not copy Obsidian's code,
  name, or design (sections 5.6, 5.9).
- The brain is divided into **functional regions** (Memory, Planning,
  Execution, Research, Workflows, Connectors, Subagents). Each region
  lights up only for matching real events (section 4.5).
- Screen layout: the brain is the whole application world. All modules
  are floating overlays on top of it (section 4.3).
- Visual direction confirmed: matte black, anthracite, silver, white.
- Eleven features beyond Obsidian added, under a strict clarity rule
  (sections 4.6, 5.10).
- Roadmap, acceptance criteria, and open questions updated.

### Changes in 1.1

- Added confirmed project decisions (section 0).
- Target platforms are now Windows **and** macOS.
- The brain is now a rotatable 3D scene that can be zoomed into and
  explored from the inside (section 4.2).
- Imported files are **copied** into the library by default. A library
  panel shows which files are stored and how many (sections 5.1, 5.8).
- Monitoring covers all Claude Code sessions running on the local
  machine, with a filter for selected sessions (section 6.7).
- Obsidian vault import moved up in priority because the user already
  has a vault (section 9.3).
- New section 10: **Plugin & Connector Readiness Check**. This is a
  global working rule for Claude, shipped with NEURAL OS as an opt-in
  component, plus its visualization.
- Updated flows, roadmap, acceptance criteria, and open questions.
- Appendix A: the exact text of the readiness rule.

------------------------------------------------------------------------

# 0. Confirmed project decisions

These decisions were made by the user and should not be reopened
without a reason.

| Topic | Decision |
|---|---|
| Existing code | None. The project starts from an empty repository. |
| Who builds it | Claude Code builds the whole application. The user tests and gives feedback. |
| Platforms | Windows and macOS. Both are first-class targets from Phase 1 onward. The user has both and tests on both. |
| Release goal | Personal use first. If the app is good, public release (similar reach to Obsidian). Build so that a release is possible without a rewrite (Phase 7). |
| Brain visualization | 3D, rotatable, zoomable with the mouse wheel, explorable from the inside. |
| Brain organization | Functional regions (section 4.5). Projects are clusters inside the Memory region. |
| Screen layout | The brain fills the whole window as the application's world. Modules open as floating overlays; there are no separate pages. |
| Visual direction | Matte black, anthracite, silver, white. Calm idle mode, clear active mode. |
| Obsidian | NEURAL OS replaces Obsidian for the user: own editor, links, backlinks, tags, search, graph. The library stays a plain Markdown folder. |
| Extra features | All eleven features in section 5.10, as long as the interface stays clear (section 4.6). |
| File import default | Single files and small folders: copy into the NEURAL OS library. Originals stay untouched. |
| Large or live folders | Linked in place, read-only, watched for changes (section 5.1). Used for the user's vault. |
| Monitored sessions | All local Claude Code sessions by default, with a filter for selected ones. |
| Obsidian vault | About 80 GB, used for Roblox game development, edited continuously by Claude Code from the user's other account. Linked in place, never copied, never written to by NEURAL OS. Part of Phase 2. |
| Obsidian plugins | The user relies on Claude Code plugins, not on Obsidian community plugins. No Obsidian plugin compatibility is needed. |
| Readiness rule | Applies to **all** of the user's Claude Code projects, not only NEURAL OS. NEURAL OS ships it as an opt-in component. |
| Readiness threshold | Tasks that involve external services or more than a few files (section 10.3). |
| Connector priority | Claude proposes the order after Phase 0, based on the user's real setup. The user approves it. |
| Document language | English. |
| Core story | NEURAL OS is the long-term memory of your AI. Obsidian stores what you know; NEURAL OS also shows and remembers what your AI does with it (section 5.12). |
| Signature features | AI change log (first), self-writing memory, context on request with memory flash, shareable brains, brain time-lapse (section 5.12). |
| Context for Claude | Claude may request context from NEURAL OS through a local MCP server; NEURAL OS answers deterministically, without AI (section 3.5). |
| UI language | German and English, switchable in Settings. Default follows the operating system language. All UI text lives in translation files from the start, no hard-coded strings. Note content is never translated. |

# 1. Executive summary

NEURAL OS is a standalone desktop application for Windows and macOS. It
combines:

1.  **A full knowledge workspace that replaces Obsidian** for the user.
    Users write Markdown notes, add files to a local library, inspect
    their contents, connect related information, and explore everything
    through a 3D graph. It adds features Obsidian does not have,
    especially around Claude's work.
2.  **A live activity monitor for Claude Code.** Claude keeps working
    in its normal environment. NEURAL OS observes supported, real events
    from Claude Code and visualizes them in a central 3D neural-brain
    interface.
3.  **A readiness layer for Claude's tools.** NEURAL OS ships a
    global, opt-in working rule. Under that rule Claude checks which
    plugins and connectors a task needs before it starts, and asks the
    user before adding anything. NEURAL OS shows the observable parts of
    this check.

The guiding principle is:

> **Claude works. NEURAL OS visualizes and organizes. The user stays in
> control.**

NEURAL OS is not a new AI model, autonomous agent, chatbot, coding
assistant, or replacement for Claude Code. It must not perform Claude's
tasks on its own, modify project files, or pretend to know Claude's
private internal reasoning.

The application should feel like a premium, calm, dark desktop
environment. The user's knowledge and Claude's observable activity
become one navigable visual system.

# 2. Product vision

The central metaphor is a human brain made from a network of neurons,
nodes, and fine connecting pathways.

-   Files, notes, concepts, projects, and other knowledge objects can be
    represented as nodes.
-   Relationships between those objects are represented as connections.
-   Observable Claude Code activity can light up the relevant file or
    project node and show a live activity path.
-   The user can inspect any knowledge node to understand what it
    represents and what its source contains.
-   The graph should show structure and relationships without becoming
    a confusing mass of dots.

The brain is not a decorative logo or a separate tab. It is the main
environment and the visual center of the application.

# 3. Product boundaries and non-goals

## 3.1 What NEURAL OS does

-   Stores and organizes user-provided knowledge files locally.
-   Supports a navigable knowledge graph with nodes and relationships.
-   Provides file previews and content inspection.
-   Allows the user to create and manage links between knowledge
    objects.
-   Monitors supported Claude Code events through supported integration
    mechanisms.
-   Shows observable tool activity, projects, sessions, models,
    subagents, and status where the available event data permits.
-   Offers history, search, filters, project views, connector status,
    and system status.
-   Provides a connector architecture that can be extended over time.
-   Optionally installs and manages the Plugin & Connector Readiness
    rule for Claude Code (section 10), with explicit user consent.

## 3.2 What NEURAL OS does not do in the initial product

-   It does not replace Claude Code or Claude Desktop.
-   It does not provide its own AI model or autonomous agent.
-   It does not make decisions about Claude's tasks.
-   It does not write code, edit project files, run terminal commands,
    or execute workflows on Claude's behalf. The only exceptions are the
    consent-based configuration writes in section 3.4.
-   It does not install plugins or connectors itself. Claude proposes
    them and the user approves them inside Claude Code.
-   It does not claim to display Claude's private chain-of-thought or
    hidden internal reasoning.
-   It does not force model routing or manually assign models to Claude
    tasks.
-   It is not a general-purpose code editor.
-   It does not copy Obsidian's source code, name, branding, or visual
    design. It builds the proven concepts (Markdown, links, backlinks,
    tags, graph) independently.
-   It has no command input that gives Claude tasks. Tasks are given in
    Claude Code. The command palette (Ctrl/Cmd+K) only controls NEURAL
    OS itself.
-   It does not silently upload private user data to a cloud service.

The application may display controls for searching, filtering,
navigating, and managing its own knowledge library. These are not
task-execution commands for Claude.

## 3.3 Important distinction: visible events vs. internal reasoning

The neural visualization must be based on real, observable
information:

- A supported file-read event.
- A supported file-edit event.
- A supported terminal or tool invocation.
- A supported MCP or tool event.
- A session or task lifecycle event.
- A model or subagent field, if the integration exposes it.
- A project or working-directory field, if available.

It must never invent thoughts, intentions, or hidden reasoning. If an
event is inferred from limited metadata, label it as inferred. If
information is unavailable, show "not available" rather than make it up.

## 3.4 Configuration NEURAL OS may write

NEURAL OS is read-only toward the user's project files, with the
exceptions listed here. There are exactly three kinds of Claude Code files it may write, and only after
explicit, per-item consent:

1.  The hook configuration needed for monitoring (section 6).
2.  The Plugin & Connector Readiness rule block (section 10).
3.  Claude's instruction and memory files (`CLAUDE.md` and Claude Code
    memory files), when the user edits them in NEURAL OS (section 5.10,
    feature 3). They are shown read-only by default; each save needs
    confirmation.

For all three:

- Show the exact change before applying it.
- Back up the existing file first.
- For hooks and the readiness rule: write only inside a clearly marked,
  NEURAL OS-owned block, and never change content outside that block.
- For memory and instruction files: save only the user's own edit,
  after showing a diff.
- Offer a one-click removal that restores the previous state.
- Record each change in the Evolution / Change Log module.

## 3.5 Answering Claude's requests (context server)

NEURAL OS ships an optional, local MCP server that Claude Code can use as a
tool. It is the only channel through which information flows from NEURAL OS
to Claude, and it only ever **answers**; it never starts a conversation,
never gives Claude a task, and never calls a model.

- Opt-in during setup (Flow A) and in Settings, installed with the consent
  rules of section 3.4 (exact diff, backup, one-click removal).
- Local transport only (stdio). No network listener.
- Read-only tools, for example: search the library, get the session notes
  of a project, build a context pack for a project and topic, list the
  imported brains. Exact tool names are fixed in Phase 5.
- Answers are built without AI: project membership, links, tags, recency,
  Claude traces and full-text search. Every answer lists its sources.
- Respects privacy: excluded folders, private notes and foreign-brain
  boundaries apply. A size limit keeps answers small (token cost).
- Every request appears as a real event in Activity and drives the memory
  flash (section 5.12, S3).

# 4. Visual design system

## 4.1 Overall appearance

-   Full-screen desktop application on Windows and macOS.
-   Dark neutral palette: black, charcoal, graphite, silver, chrome, and
    white.
-   Minimalist, premium, restrained, and technical.
-   Fine lines, subtle luminous nodes, controlled reflections, and
    restrained glow.
-   No heavy neon colors, rainbow gradients, cluttered sci-fi cockpit
    styling, or cartoonish effects.
-   Typography should be clean, highly legible, and understated.
-   Panels should be translucent or visually light enough that the brain
    stays visible behind them.
-   Respect platform conventions where it matters: window controls,
    keyboard shortcuts (Ctrl on Windows, Cmd on macOS), and file dialogs.

## 4.2 Central brain (3D)

The main visualization is a **real-time 3D scene**. It must stay clearly
recognizable as a human brain silhouette.

Shape and style:

-   The brain is built from fine neural filaments, nodes, and connected
    pathways.
-   It should read as a brain at first glance, not as an amorphous cloud
    or generic network. This must hold from every viewing angle.
-   No realistic flesh, muscles, organs, or graphic anatomical detail.
-   Silver-white pathways and metallic nodes against a dark background.
-   The network may extend beyond the brain silhouette into the
    surrounding space.
-   **Anatomical recognizability:** the default view is the side
    profile. The cortex shows lobes (frontal, temporal, occipital),
    the lateral and central fissures, the gap between the hemispheres,
    and fine fold lines (gyri and sulci), similar to a technical
    anatomical drawing. Cerebellum and brainstem are clearly separate.
-   **Nervous system:** the brainstem continues into a spinal cord.
    Connectors are shown as **peripheral nerves**: fine fibre bundles
    branch from the spinal cord to glowing connector nodes, grouped by
    nerve type (for example Memory nerve → Obsidian vault, Development
    nerve → GitHub, Media nerve → OBS, Creative nerve → Figma). This is
    a visual metaphor only; it does not imply biological cognition.
-   **Spinal cord and connector nerves (no body):** below the brain
    there is only a short, gently curved spinal cord, no body, no
    skeleton. Every connector is wired in by its **own nerve**: an
    organic fibre bundle (a few twisting fibres that taper, small side
    twigs, a terminal arborisation around the connector node). Each
    nerve leaves the cord at its own level, top to bottom in connector
    order, alternating to the front and the back so the nodes and labels
    form a left and a right column in the side view. The cord grows a
    little longer when there are many connectors (camera pulls back to
    keep everything framed). On load the cord and nerves grow out from
    the brainstem; when a connector is added, only its nerve grows out
    of the cord with a bright growth tip; removing one removes its
    nerve. `prefers-reduced-motion` shows the final state at once. The
    nerve list comes from the real connector list (readiness check),
    never invented. Missing connectors keep a dimmed nerve, connectors
    needing sign-in a half-bright one. Hovering a nerve or its node
    highlights it and shows name, nerve type and status. Default camera
    is the side view of the brain with the cord and nerves below.
-   **Brain grows with the library:** the brain's size and point
    density follow the number of linked files from the file index
    (section 5), never an invented value. Scale
    f = log10(files + 1) / 5, capped at 1 (100,000 files). With no
    files the brain is a small, sparse seed (about 18 % of its points,
    72 % size); with many files it is the full, dense brain. Points
    appear in a fixed random order, so the same file count always gives
    the same picture. The brain scales around the base of the brainstem,
    so the spinal cord stays attached. Changes animate smoothly
    (instant with reduced motion). Where it lives: Overview → Library
    shows the count and explains the growth; nothing is added to the
    main screen.
-   Neuron-like nodes: bright core with a soft halo; colors stay
    silver-white with at most a faint cold tint.
-   **Anatomy labels:** thin leader lines from each region to a small
    technical label (blueprint style). One toggle (key `L`) shows or
    hides all labels; active and hovered regions are always labeled.
    Labels must stay calm while the brain turns: the marker anchor is a
    soft-weighted mean of the camera-facing region points (it glides,
    never jumps), a label keeps its side until its marker is clearly
    (about 48 px) across the middle, and label positions glide toward
    their target instead of jumping.

Reference images collected by the user (blueprint brain drawing,
glowing neurons, glass body with nervous system) define the mood:
technical, anatomical, dark, fine lines. They are references for mood
only and must not be copied.

Navigation:

-   **Rotate:** drag with the mouse to orbit around the brain.
-   **Zoom:** the mouse wheel moves the camera closer or further away.
-   **Fly-through:** zooming past the outer surface takes the camera
    inside the brain. The user can scroll through the interior and see
    the nodes and pathways there.
-   **Pan:** right-drag or modifier-drag moves the view sideways.
-   **Focus:** double-click on a node moves the camera smoothly to it.
-   **Reset:** one control or shortcut returns to the default view.
-   Trackpad gestures on macOS (pinch to zoom, two-finger rotate or pan)
    should map to the same actions.
-   Keyboard alternatives for every camera action (accessibility).

Readability inside the brain:

-   Nodes near the camera fade or become transparent so they never block
    the whole view.
-   Labels appear only for nearby, hovered, selected, or active nodes.
-   A small orientation helper (mini-brain or compass) shows where the
    camera is.
-   The camera must not get lost. There is always a way back.

Animation:

-   Connections can pulse or light up in response to activity.
-   Idle state: calm, slow, subtle movement, such as a very slow
    rotation that stops as soon as the user interacts.
-   Active state: relevant regions and paths light up in response to
    real incoming events.
-   Animations must not reduce readability or overwhelm the user.
-   Respect the operating system's "reduce motion" setting.

Performance:

-   Must stay smooth with thousands of nodes on typical laptops on both
    platforms. Use level of detail, instancing, and culling as needed.
-   A low-quality fallback mode for weak GPUs.
-   **Power saving:** render on demand. When nothing moves and no event
    arrives, stop rendering frames. Stop completely when the window is
    hidden or minimized and in focus mode. On battery, use a
    low-power mode (lower frame rate, fewer effects). Idle CPU/GPU use
    should be close to zero.

## 4.3 Screen layout: the brain is the world

NEURAL OS is not a classic app with a sidebar, a work area, and separate
pages. The 3D brain and its surrounding neural network fill the entire
window. They are the application's world, not an element inside it.

-   The background is part of the network: fine silver and white
    pathways run quietly across the whole screen.
-   Connector pathways reach from the brain out into this surrounding
    space.
-   Every module opens as a **floating overlay** (translucent, dark
    glass) on top of the brain. The brain stays visible behind it and
    keeps reacting to events.
-   Overlays are movable, resizable, minimizable, closable, and
    reopenable. Their positions are remembered.
-   Opening a module never replaces or hides the brain completely.
-   A slim, unobtrusive **dock** at the screen edge opens the modules.
    It can auto-hide.
-   A **command palette** (Ctrl/Cmd+K) opens any module, note, file, or
    action by typing. It controls NEURAL OS only.
-   A small status strip shows: monitoring on/off, number of observed
    sessions, number of active connections, library size.
-   Clicking a brain region opens its overlay (section 4.5).

Modules (opened as overlays):

| Module | Content |
|---|---|
| Overview | System status, active sessions, recent activity, library summary |
| Memory | Notes and files: editor, reader, library list (5.8, 5.9) |
| Knowledge Graph | Filters and focus tools for the graph (5.4) |
| Projects | Project cockpits (5.10, feature 9) |
| Activity | Live timeline, history, session replay (6.5, 5.10) |
| Workflows | Skills and routines Claude uses, as observed |
| Connectors | Connector map and readiness checks (9, 10) |
| Models & Subagents | Observed models and subagents (7) |
| Evolution | Change log of NEURAL OS itself (11.5) |
| Security | Permissions and every configuration change (11.4) |
| Settings | Configuration, health, retention |

Implementation may merge overlays if that improves clarity, but must
keep the underlying capabilities.

Module contents (from the design prototype):

-   **Overview:** "At a glance" tiles (active sessions, events this
    session, connectors ready x / y, linked files); "Needs attention"
    (connectors that are missing or need sign-in, each with an Open
    button to the Connectors module, or a calm "nothing needs your
    attention"); active sessions; activity by region (bars counted from
    observed events only); the three latest events; library.
-   **Activity:** compact one-line events (time, action, region), grouped
    by minute; filter chips per region with counts; full text on hover;
    clicking an event lights its region in the brain.
-   **Knowledge graph:** short explanation; node types as bars; a
    **Compare** section with two modes: *Projects* (pick two projects:
    notes, files, links and Claude sessions as mirrored bars, plus
    shared nodes, meaning notes and files linked from both) and *Time*
    (today vs. 30 days ago: nodes, links, topic clusters with growth in
    percent, fastest-growing topic); time slider; "Show in brain".
-   **Evolution:** opens with a plain explanation (what it is and what it
    is not, see 11.5), growth sparklines over the last 8 weeks (linked
    files, connectors), then the change log with a type tag per entry
    (Version, Hooks, Rule, Index, Connector), date, and full text on its
    own line.
-   **Memory:** three tabs. *Note*: Markdown preview/edit, `[[`
    autocomplete, daily note, templates, outline, local 2D graph, link
    suggestions (always tagged SUGGESTION, accept or dismiss), backlinks,
    outgoing links, unlinked mentions, Claude trace. *Library*: search,
    sort, type chips with counts, status pills (indexed, indexing,
    failed, unsupported, name only), checkboxes for a context pack,
    right-click menu, library folder. *Tags*: tag browser.
-   **Node details** (opens from a click on a knowledge node in the
    brain, not in the dock): type, size, library location, original
    source, dates, project, tags, status, preview, OCR text tagged
    GENERATED, summary ("none generated" until one exists), links,
    Claude trace, actions.
-   **Activity:** tabs *Live / History / Replay*. Live adds a session bar
    with Show / Mute / Off per session and a "cloud session · not
    observable" row. History: search, session/type/date filters,
    retention, clear history with confirmation. Replay: play/pause,
    1×/2×/4×, scrubber, replays stored events only. Error and
    session-finished rows have their own style.
-   **Connectors:** adds a readiness-check history (needs, result,
    decision, verified; "report not available"; a "suggested" state)
    and a check animation that walks the nerves.
-   **System health** (dock): event receiver, hooks per platform (macOS
    "not tested yet" until tested), app, storage, indexing, connectors,
    recent errors, resource use "not available".
-   **Security:** linked-folder read-only/edit toggle, integrations with
    disconnect, Claude Code file changes with View (diff) and Undo.
-   **Models:** session/subagent tree with status, model-change events,
    usage "not available".
-   **Projects:** switcher, new, rename, "Unassigned".
-   **Settings:** quality high/low, dock auto-hide, module on/off (hides
    dock entries), library folder, history retention, demo flows.

Knowledge nodes in the brain (Memory region) differ by shape, not
colour: note = dot, file = ring, project = diamond, Claude memory
(CLAUDE.md) = square. Edges show explicit wikilinks and project
membership. Hover shows name, type and a short excerpt; click opens
Node details; right-click opens the same context menu as the library.
A file that Claude reads pulses briefly; an edit pulses larger.

Dialogs (modal, only on demand): first launch (6 steps: what it is
and is not, library folder, import choice, hooks opt-in with exact
diff, readiness rule opt-in with exact diff, summary), import
(copy vs. link with recommendation, read-only default, exclusions,
duplicates), consent diff for Claude Code files (backup path, approve
/ cancel; hook JSON marked as an example until verified in Phase 0),
conflict (side by side or inline; keep mine / take theirs; the other
version is kept as backup), context pack (references or full text;
copy or save; never sent anywhere by NEURAL OS). Indexing shows a
temporary progress chip with pause that disappears when done. A small
orientation map appears only when zoomed close to or inside the
brain; a click resets the view. Overlays can be resized and remember
position and size; between 701 and 1000 px they become a right-hand
drawer showing one module at a time.

## 4.4 Responsive behavior

The first target is desktop. The layout must still adapt to smaller
windows:

- Panels should collapse or become drawers.
- The 3D graph must stay navigable.
- Important status information must not disappear.
- Avoid requiring a large monitor for basic file inspection and activity
  history.

## 4.5 Functional brain regions

The brain is divided into regions by **function**, not by project. A
region lights up only when a matching real event arrives. The mapping
is fixed and documented, so the user always knows why something lights
up.

| Region (anatomical position) | Function | What lives there | Lights up when Claude Code reports ... |
|---|---|---|---|
| Hippocampus / temporal lobe | **Memory** | Library files and notes, clustered by project | a file read |
| Prefrontal cortex | **Planning** | Task lists and plans, as observed | a task-list or plan tool call |
| Motor cortex | **Execution** | Terminal commands, file changes | a terminal command or a file edit/write |
| Occipital lobe | **Research** | Web sources | a web search or web fetch |
| Cerebellum | **Workflows** | Skills and routines | a skill invocation |
| Brainstem, spinal cord, peripheral nerves | **Connectors** | MCP servers, plugins, external apps, each at the end of its nerve | an MCP or connector tool call, or a readiness check (the matching nerve lights up) |
| Side branches | **Subagents** | Subagent activity | a subagent start or stop |

Rules:

-   The exact event-to-region mapping is built in Phase 3 from the
    verified hook events. Any event that fits no region goes to a
    neutral "other" pathway, never to a guessed region.
-   Regions show **activity**, not thinking. The labels describe tool
    use ("reading a file"), never mental states ("thinking", "deciding").
-   Within the Memory region, each project forms its own cluster. Inside
    a cluster, notes are placed by their links. Unassigned files form a
    separate cluster.
-   Each region is subtly outlined on hover and labeled. Clicking it
    opens the matching overlay.
-   Activity paths can travel between regions in the order the events
    actually happened (for example Memory → Execution when Claude reads
    a file and then edits one).

## 4.6 Clarity principle

The product has many features. It must still feel calm and simple. This
is a hard requirement, not a nice-to-have.

-   **Calm by default.** On launch, only the brain, the dock, and the
    status strip are visible. No overlay is open unless the user left it
    open.
-   **Progressive disclosure.** Details appear only on hover, click, or
    request. Advanced options sit behind "more".
-   **One thing at a time.** At most two or three overlays open at once
    by default. Opening more stacks or tabs them.
-   **Labels only where needed.** Node labels appear only for nearby,
    hovered, selected, or active nodes.
-   **Quiet animation.** Only real events trigger visible activity, and
    only briefly.
-   **Every feature can be turned off** in Settings if the user does not
    use it, and its dock entry then disappears.
-   **Review rule for development:** every new feature must name where it
    lives (which overlay or region) and must not add permanent elements
    to the main screen.

## 4.7 Discoverability: how people find the features

Powerful features are useless if nobody finds them. Rules:

-   **Show, then explain.** A feature is introduced at the moment it
    first becomes useful, by a small, dismissible hint next to the event
    that triggered it, never by a long tour up front. Examples: the first
    time Claude edits a note, a hint offers "See what Claude changed";
    the first time a session ends, "Your session note is ready"; the
    first time Claude asks for context, the memory flash plays with a
    one-line caption.
-   **Each hint appears once**, can be turned off globally, and lives in
    a "What's new / tips" list in Overview so it can be found again.
-   **Feature videos.** The welcome dialog shows short, clearly labeled
    demo videos (about 20 to 40 seconds each) of the signature features,
    so a new user understands what works and how, without Claude Code and
    without their own files. The same videos are reachable later from
    Overview → "What's new / tips". They are bundled with the app (no
    streaming) and recorded from the real app with demo data.
-   **Three-minute guided start** (optional, from the welcome dialog):
    link a folder, watch one real Claude action light up, open the
    resulting session note. Stops as soon as the user does each step
    themselves.
-   **Command palette knows everything.** Every feature is reachable by
    typing what you want ("what did Claude change", "share brain").
-   Clarity principle (4.6) still applies: hints are temporary and never
    add permanent elements to the main screen.

**Spreading the word (release, Phase 7):**

-   The brain time-lapse (S5) is the built-in growth loop: every exported
    clip carries a small, removable "made with NEURAL OS" mark and is
    privacy-filtered by default.
-   Shareable brains (S4) spread the app: opening a `.brain` file needs
    NEURAL OS, and the import screen explains what it is.
-   Launch content: a 60-second vertical video per signature feature
    (the same recordings as the in-app feature videos) and public example
    brains (for example Roblox game development). No product website is
    planned; distribution runs through the videos, shared clips and
    shared brains.
-   Positioning line everywhere: "Obsidian stores what you know. NEURAL
    OS also shows you what your AI does with it."

# 5. Knowledge workspace --- replacing Obsidian

This is a core part of NEURAL OS, not an optional decorative feature.

## 5.1 Adding files

Users can add files through:

- Drag and drop onto the window or the brain.
- A file picker.
- Folder or project import, where technically safe and feasible.

**Default import behavior: copy.** Each imported file is copied into the
NEURAL OS library folder. The original file is never moved, changed, or
deleted.

- Before a large import, show the number of files and the total size,
  and ask for confirmation.
- Detect duplicates by content hash. If the same file is already in the
  library, tell the user instead of storing it twice.
- Keep a record of where each copy came from (original path and import
  date), shown in the node details.
- A "re-import from original" action can update a library copy if the
  original changed. This only runs when the user chooses it.
**Linked folders (for large or live folders).** Copying does not work for
folders that are very large or that other tools keep changing. The
user's vault is both (about 80 GB, edited by Claude all the time). For
these, NEURAL OS offers a second, explicit mode:

- The folder stays where it is. NEURAL OS stores only its path, an
  index, and metadata.
- **Read-only by default:** NEURAL OS does not write to a linked folder
  unless the user turns on editing for that folder. NEURAL OS tags and
  links for linked files are stored in NEURAL OS's own database.
- **Optional editing (per folder, opt-in):** to truly replace Obsidian,
  the user can allow editing Markdown files in a linked folder. Safe
  write rules: before saving, check that the file on disk has not
  changed since it was opened (hash or modification time); if Claude or
  another tool changed it, show a conflict view (keep mine / take
  theirs / compare) instead of overwriting. Keep a local backup of the
  previous version for every save. Never write binary or non-Markdown
  files.
- **Watched:** file changes are picked up automatically and the graph
  updates. When Claude edits a file in the vault, the matching node
  lights up through monitoring and the new content appears.
- **Selective indexing:** index text formats (Markdown, text, Lua/Luau
  scripts, JSON) fully. For large binary files (game files such as
  `.rbxl`/`.rbxm`, meshes, audio, video, big images) store only name,
  type, size, and dates. Exclude folders by pattern (for example
  build output or caches).
- **Fast and incremental:** the first index of a large folder runs in
  the background with visible progress, can be paused, and must not
  block the app. Later updates only process changed files.
- **Graph size:** with tens of thousands of files, the graph shows
  folders as collapsed clusters by default and expands on zoom or
  click (clarity principle, section 4.6).
- The import dialog suggests the mode: copy for single files and small
  folders, link for folders above a size threshold (for example 1 GB or
  5,000 files) or folders that change often.

Initial file support should prioritize:

- Markdown (`.md`)
- Plain text (`.txt`)
- PDF (`.pdf`)
- Common office documents such as DOCX
- Images such as PNG, JPG, and WEBP

Other formats can be added through a modular parser system. Do not claim
support for a format until its parser and preview behavior have been
tested on both Windows and macOS.

Extracted text, thumbnails, indexes, and metadata are derived data. They
are stored separately and must never overwrite the library copy or the
original.

## 5.2 File and knowledge nodes

Each imported file is represented by a node in the graph. Other node
types may include:

- Project
- Folder or collection
- Note
- Topic or concept
- Tag
- Session
- Observable activity event
- Readiness check (section 10)
- External resource or connector reference

Node types should be visually distinguishable without a large,
distracting color palette. Use 3D shape, icon, border or outline
treatment, or subtle tonal differences.

## 5.3 Hover and click behavior

When the user hovers over a node:

- Show a compact preview.
- Show the title and type.
- Show a short excerpt or metadata if available.
- Indicate whether the node is a file, note, project, activity, or other
  object.

When the user clicks a node, open a detail panel containing:

- Name and file type.
- Library location and original source location.
- Content preview appropriate to the file type.
- Extracted text, where available.
- Summary only if one has actually been generated. Label it as a
  summary, not source text.
- Tags and project association.
- Import date and last-modified metadata, where available.
- Linked nodes and incoming/outgoing relationships.
- Relevant Claude activity involving this file, if captured.
- Actions to open the file, rename the library entry, change tags, or
  manage graph links, subject to permissions.

Do not show the full contents of a large file inside a small hover
tooltip. Use a short excerpt on hover and a proper reader or detail
panel on click.

## 5.4 Relationships and graph behavior

The knowledge graph should support:

- Explicit links between files and notes.
- Backlinks and outgoing links.
- Project and folder grouping.
- Tags and topic relationships.
- Search-based highlighting.
- Filtering by node type, project, tag, and relationship.
- Focusing on a selected node and its nearby connections.
- Zoom, rotation, fly-through, and reset (section 4.2).
- A way to reduce visual clutter, such as hiding distant or inactive
  nodes.

Do not create semantic relationships and present them as facts unless
the user created them. **Auto-sort on import (user decision
2026-11-16):** new files are sorted into the matching project and
linked automatically by fixed rules (wikilinks in the file, mentions of
another file's name, same source folder except generic folders such as
Downloads, a shared distinctive word in the name). Every automatic link
stores its rule as the reason, is marked as automatic (not as a fact
the user wrote), and can be removed. A project the user set is never
overwritten. The user can turn this off in Memory → Library; then
automatic links stay suggestions (feature 8) until approved.

## 5.5 Search and navigation

Provide:

- Global search across filenames and indexed text.
- Filters by project, file type, tag, and node type.
- Search-result navigation that flies the camera to the relevant node.
- A clear way to return to the full graph.
- Recent files and recently visited nodes.

## 5.6 Editing policy

NEURAL OS replaces Obsidian, so Markdown note editing is a core feature.

-   Notes created in NEURAL OS and imported Markdown files can be edited.
    Editing always changes the library copy, never the original outside
    the library.
-   Non-Markdown files (PDF, DOCX, images) are view-only. Their tags,
    links, and library names can be changed.
-   Autosave with a local version history per note, so any edit can be
    undone.
-   It is a notes editor, not a code editor: no project-file editing,
    no build tools, no terminal.

## 5.7 Data integrity

-   Never change originals.
-   Make import behavior explicit.
-   Avoid duplicate imports (content hash).
-   Keep stable internal IDs for nodes.
-   Store links independently of display names so renaming does not
    break relationships.
-   Provide clear error messages for unsupported, corrupted, or
    inaccessible files.
-   Removing an item from the library deletes only the library copy and
    its derived data, after confirmation. The original is never
    touched.
-   Handle path differences between Windows and macOS (separators, case
    sensitivity, Unicode normalization, long paths).

## 5.8 Library panel

The library list is part of the Memory overlay and shows what is in the
library:

- Total number of files and total size.
- Counts by file type.
- A searchable, sortable list of all files (name, type, size, import
  date, project).
- Status per file: indexed, indexing, failed, unsupported.
- Selecting a file in the list flies the camera to its node.
- Location of the library folder on disk, with an "open folder" action.
- Library folder location can be changed in Settings, with a guided move.

## 5.9 Note-taking core (Obsidian replacement)

These are the features the user relies on in Obsidian. They are built
independently in NEURAL OS:

-   Markdown editor with live preview (headings, lists, checkboxes,
    tables, code blocks, images, frontmatter).
-   Wikilinks: `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, with
    autocomplete while typing.
-   Backlinks and "unlinked mentions" (places that name a note without
    linking it).
-   Tags (`#tag` and frontmatter), with a tag browser.
-   Full-text search with filters.
-   Folders and projects.
-   Daily notes with a configurable template.
-   Note templates.
-   Renaming a note updates all links to it.
-   The 3D graph replaces Obsidian's global graph view.
-   **Local graph:** a small, flat (2D) graph inside the note overlay
    showing only the current note and its direct neighbors. This is the
    view people actually use while writing; the 3D brain is for overview
    and activity.
-   **Focus mode:** one shortcut turns the editor into a large, calm
    writing surface. The brain dims and pauses its animation behind it.
-   **Obsidian-flavored Markdown compatibility**, so existing vault
    notes render correctly: callouts (`> [!note]`), embeds
    (`![[Note]]`, `![[image.png]]`), block references (`^id`), comments
    (`%% ... %%`), highlights (`==text==`), footnotes, math (LaTeX), and
    Mermaid diagrams. Unsupported syntax is shown as plain text, never
    lost or rewritten.
-   Outline (table of contents) of the current note.

**Library format:** the library stays a normal folder of Markdown files
plus attachments. NEURAL OS metadata (IDs, links, index) lives in its
own database and a hidden folder, never inside the notes in a
proprietary format. The user can open the library in any Markdown tool,
including Obsidian, at any time.

Later (not in the first milestone): canvas boards, table/database
views, Kanban boards.

## 5.10 Features beyond Obsidian

All of these are in scope. Each one must follow the clarity principle
(section 4.6) and states where it lives.

| # | Feature | What it does | Where it lives |
|---|---|---|---|
| 1 | **Claude traces on notes** | Each note and file shows when Claude read or changed it, and in which session (from real events only). | Node details, Memory overlay |
| 2 | **Session replay** | A finished Claude session can be replayed as an animation over the brain, with play, pause, and speed control. Uses stored events only. | Activity overlay |
| 3 | **Claude's memory as notes** | `CLAUDE.md` files and Claude Code memory files of the user's projects appear as nodes. Read-only by default; editing follows section 3.4. | Memory region, special node type |
| 4 | **Context packs** | The user selects notes and files and creates a context pack: a single Markdown file or a list of file references that the user can give to Claude in Claude Code. NEURAL OS does not send it to Claude itself. | Memory overlay, right-click menu |
| 5 | **Time slider** | Shows how the knowledge network grew over time (by import and creation dates). | Knowledge Graph overlay |
| 6 | **3D graph with fly-through** | Section 4.2. | Main screen |
| 7 | **Searchable PDFs, Word files, images** | Text extraction for PDF and DOCX; local OCR for images and scanned PDFs. All local, no cloud. | Search, node details |
| 8 | **Link suggestions** | Local analysis (unlinked mentions, shared tags, text similarity) suggests links. Shown as suggestions; nothing becomes a link without the user's approval. Can be turned off. | Node details, small badge |
| 9 | **Project cockpit** | One overlay per project: its files, notes, Claude sessions, Git status (read-only, if a repository path is set), and connectors. | Projects overlay |
| 10 | **Connector map with readiness** | Visual map of connected tools and their state, plus the readiness check history (section 10). | Connectors overlay, Connectors region |
| 11 | **Command palette** | Ctrl/Cmd+K: open any note, file, module, or action by typing. NEURAL OS only. | Global shortcut |
| 12 | **Stream overlay** | A clean, transparent view of the brain for OBS Studio and other streaming tools, so viewers see Claude's real activity live while the user builds. Privacy mode is forced on. Offered as a browser source on localhost (read-only, local only) or a separate borderless window. | Settings → Stream overlay | 
| 13 | **Stale-note warning** | Marks notes that Claude reads often while the files they link to (for example scripts) changed much more recently. Based only on read events, links and modification dates; shown as a hint, never changes the note. | Node details, Memory → Library filter |
| 14 | **Daily recap (optional, off by default)** | In the evening, one note "Today with Claude" listing that day's session notes (S2). | Memory region, `Sessions/` |

Rules for these features:

-   Everything runs locally. No feature uploads data.
-   Anything generated (suggestions, extracted text, OCR text) is
    labeled as generated and kept apart from source content.
-   No feature gives Claude tasks or runs actions in Claude Code.

## 5.11 Why NEURAL OS instead of Obsidian --- honest assessment

**Reasons to switch:**

-   It shows Claude's real work on your knowledge: which notes and files
    Claude read or changed, live and afterwards (features 1, 2).
-   Claude's own memory and instruction files become visible, linked
    notes (feature 3).
-   It helps hand the right context to Claude (feature 4) and shows
    which tools Claude has (feature 10).
-   PDFs, Word files, and images are searchable out of the box (feature
    7).
-   A distinctive 3D overview of everything, without plugins.
-   Same safety as Obsidian: plain Markdown files, local-first, no
    lock-in.

**Weak points and how the spec handles them:**

| Weak point | Why it matters | Mitigation in this spec |
|---|---|---|
| No plugin ecosystem, themes, or community | Obsidian's biggest strength. NEURAL OS cannot match it at launch. | Focus on built-in features that matter for AI-assisted work. Keep the architecture modular so a plugin API is possible later (open question, section 18). |
| No mobile app and no sync | Many users read and write notes on the phone. | Honest scope: desktop only. Because the library is plain files, any file-sync tool and any mobile Markdown app can still be used. Mobile is a later decision. |
| 3D is bad for writing and for reading detailed structure | A spinning brain distracts while writing, and 3D graphs are hard to read precisely. | Focus mode, the flat local graph in the note overlay, and the clarity principle (sections 4.6, 5.9). The 3D brain is for overview and activity, not for writing. |
| Constant 3D rendering costs battery and GPU | Obsidian is light; a heavy app that drains the laptop gets uninstalled. | Power rules in section 4.2: stop rendering when nothing changes, when the window is hidden, and in focus mode; low-power mode on battery. |
| Value depends on Claude Code | Without Claude Code, it is "a note app with a 3D graph", which is weak for a public release. | Phase 7 requires the knowledge workspace to be fully useful on its own. Positioning: "the knowledge workspace for people who work with AI coding agents". Supporting other agents later is an open question (section 18). |
| Existing vault notes may render wrongly | Users judge a replacement in the first minute with their own notes. | Obsidian-flavored Markdown compatibility (section 5.9) is part of Phase 2 and tested with the user's vault. |
| A linked vault that cannot be edited does not replace Obsidian | The user would still need another editor for the main vault. | Optional editing for linked folders with conflict detection and backups (section 5.1). |
| Huge vaults (80 GB) | Slow indexing and an unreadable graph would make it unusable for exactly this user. | Selective, incremental indexing, collapsed folder clusters, Phase 4 hardening. |
| Showing live activity can expose private paths | Screenshots, screen sharing, and recordings (for example with OBS) can leak file names and project names. | Recording/privacy mode (section 13): hides paths and names behind generic labels with one shortcut. |
| A new, unknown app is a trust risk | Users fear losing notes in a young product. | Plain files, version history, backups before every write, no proprietary format inside notes, export at any time. |

## 5.12 Signature features --- why people switch

Section 5.10 lists useful extras. These five features are the reason to
choose NEURAL OS. Together they tell one story: **your AI's long-term
memory, which you can see, trust, and share.** All of them use real,
observed data only.

| # | Feature | What it does | Where it lives | Phase |
|---|---|---|---|---|
| S1 | **AI change log** | Every change Claude makes to a note or text file, per session, with before and after. NEURAL OS keeps the previous version in its own store (read when the edit event arrives, before or right after the write, as the verified events allow). Restore is offered only where editing for that folder is enabled (5.1). | Activity → Changes, node details, session note | 3 |
| S2 | **Self-writing memory** | After each Claude session, NEURAL OS writes a session note into the library: project, time, files read, files changed (links to S1 diffs), tools and connectors used, and, if the user enabled it, Claude's own final message. The note links to every file it mentions, so a new neuron grows in the brain. Nothing is invented or summarized by NEURAL OS. | Memory region, library folder `Sessions/` | 3 |
| S3 | **Context on request + memory flash** | Claude asks NEURAL OS (section 3.5) for context, for example "what happened last time in this project". NEURAL OS answers with session notes and linked notes. The returned notes light up in the brain and travel down the Claude nerve as a light path. | Context server, brain | 5 |
| S4 | **Shareable brains** | Export a project as a `.brain` file: selected notes, session notes, project Claude rules. Before export, NEURAL OS shows every item and filters paths, names and secrets (like privacy mode). Importing docks a foreign brain to the user's brain with its own nerve. It is read-only, clearly marked as foreign, never mixed into the user's notes, and can be removed in one click. Claude can query it through the context server. | Projects overlay, brain | 6 |
| S5 | **Brain time-lapse** | Render a session or a day as a short video (16:9 or 9:16): the brain grows, regions flash, changes appear. Privacy mode on by default. | Activity → Replay → Export | 5 |

Rules:

-   S2 stores Claude's final message only after explicit opt-in (privacy,
    section 13). Default: events and file lists only.
-   `.brain` files are plain data (Markdown plus a manifest), never
    executable. Importing treats all content as untrusted.
-   A public exchange for brains (marketplace) is a later, separate
    decision with its own privacy and licensing review (section 18).

# 6. Claude Code live monitoring

## 6.1 Main behavior

Claude Code remains the environment in which Claude actually works.
NEURAL OS receives supported event data and visualizes it.

The first integration target is Claude Code, including the Claude Code
sessions inside the Claude desktop app, if they use the same hook
system. Verify this.

A likely implementation path:

1. Configure supported Claude Code hooks.
2. Have hooks send event payloads to a local event receiver.
3. Validate and normalize incoming events.
4. Store event history locally.
5. Stream updates to the desktop interface.
6. Highlight the relevant project, file, or activity node in the graph.

Inspect the current official Claude Code documentation and the actual
installed version before implementing hooks. Do not assume event names,
payload fields, or hook coverage without verifying them.

Hook commands must work on both Windows and macOS. Avoid shell-specific
syntax, or provide a small cross-platform forwarder executable or
script.

## 6.2 Event categories to investigate

The integration should investigate which supported hook events can
reliably report:

- Session start and end.
- User prompt lifecycle metadata, where supported and appropriate.
- Tool invocation and tool result lifecycle.
- File reads.
- File edits or writes.
- Terminal commands.
- Browser or research tool use.
- MCP tool use.
- Plugin, skill, and connector discovery or installation steps
  (section 10).
- Task completion or errors.
- Subagent start, progress, and completion.
- Model name or model changes, if exposed.
- Working directory and project context.

This is a list of desired categories, not a claim that Claude Code
currently exposes every one of them. Verify each against the official
documentation and test it.

## 6.3 Local event receiver

Create a small local service or bridge that:

- Accepts event payloads from configured hooks.
- Validates input and rejects malformed payloads.
- Normalizes events into an internal schema.
- Adds receipt timestamps.
- Links events to sessions and projects when the data supports it.
- Stores events locally.
- Streams updates to the desktop UI.
- Handles app restarts and temporary connection loss gracefully.
- Never blocks or slows down Claude Code. If NEURAL OS is closed, the
  hook must fail fast and silently, without affecting Claude.
- **Hooks are silent.** They print nothing to standard output or error
  and always exit successfully. Some hook types add their output to
  Claude's context; silent hooks keep monitoring free of token cost and
  never influence Claude's behavior. Verify this per hook type in
  Phase 0.

Security requirements:

- Bind to localhost by default.
- Never expose an unauthenticated event receiver to the network.
- Validate origin and payload size where applicable.
- Use a local secret or equivalent protection if the chosen transport
  needs it.
- Do not log sensitive prompt contents or file contents by default.
- Make event logging and retention configurable.

## 6.4 Proposed normalized event schema

Use a versioned internal event format. Example fields:

``` json
{
  "schema_version": 1,
  "event_id": "stable-unique-id",
  "received_at": "ISO-8601 timestamp",
  "source": "claude_code",
  "session_id": "optional-session-id",
  "project_id": "optional-project-id",
  "event_type": "tool_started",
  "tool_name": "optional-tool-name",
  "file_path": "optional-file-path",
  "working_directory": "optional-path",
  "model": "optional-model-name",
  "subagent_id": "optional-subagent-id",
  "status": "started",
  "duration_ms": null,
  "summary": "short safe description",
  "raw_metadata": {}
}
```

This is a proposed internal format, not a Claude Code payload. Map only
fields that actually exist in incoming events. Keep raw metadata
optional, minimal, and protected. Never store secrets or full private
content without need.

## 6.5 Live Activity panel

Display:

- Current observable sessions.
- Current project or working directory, if known.
- Most recent tool activity.
- Current action status.
- Event timeline.
- File paths involved, subject to privacy settings.
- Model and subagent information only when exposed.
- Errors and completion events.

The user can click an activity item to fly to the matching file or
project node, if that node exists and the path can be resolved.

## 6.6 Brain visualization response

Events light up their functional region (section 4.5) and, where
possible, the exact node involved.

Examples:

- A file-read event lights up the Memory region, the matching file node,
  and a connecting path.
- A file-edit event produces a different activity state than a read.
- A terminal event lights up the Execution region.
- A session start gently activates the project's cluster in the Memory
  region.
- A subagent event may be shown as a separate activity branch if the
  event data supports it.
- A readiness check shows as a short scan across the Connectors region
  (section 10.6).

The animation must reflect real event metadata. It must not simulate
hidden thinking or suggest that the app knows more than it does.

## 6.7 Which sessions are monitored

- **Default:** all Claude Code sessions running on this computer whose
  hooks report to NEURAL OS.
- To cover all sessions, hooks are installed at the user level of Claude
  Code, not per project. Verify the correct settings location and scope
  for the installed version on both platforms.
- The user can filter the view to one or more selected sessions, or to
  one project.
- The user can mute a session (still recorded, not animated) or exclude
  it (not recorded).
- Each session has a readable label: project folder name, start time,
  and session ID when available.
- Sessions that run elsewhere (for example cloud sessions on remote
  machines) are not observable through local hooks. Show them as "not
  observable" if they are known, instead of guessing their activity.

# 7. Models and subagents

The user wants Claude to keep choosing suitable models and subagents
automatically where Claude Code supports this.

NEURAL OS observes this behavior. It does not control it.

Potential display fields:

- Active model.
- Model change events.
- Subagent name or ID.
- Subagent task label, if exposed.
- Subagent status.
- Parent session or task relationship.
- Usage or cost data only if an authorized, reliable source exposes it.

Do not invent a model, usage, cost, or subagent status. Do not build a
model router in the initial version. Verify current Claude Code model
and subagent capabilities against official documentation during
implementation.

# 8. Projects and workspaces

A project is a useful grouping for:

- Knowledge files.
- Notes and links.
- Claude Code sessions.
- Activity events.
- Readiness checks.
- Connector references.
- Project metadata.

Project detection may use a configured workspace folder or reliable
event metadata. The user can create, rename, select, and organize
projects inside NEURAL OS without changing the original project files.

Do not assume every event can be assigned to a project. Provide an
"unassigned" or "unknown project" state when needed.

# 9. Connector and plugin ecosystem

## 9.1 Connector architecture

Use a modular connector/adapter architecture. A connector declares:

- Name and identifier.
- Category.
- Connection state.
- Supported capabilities.
- Required permissions.
- Configuration status.
- Last successful activity, if available.
- Error state and diagnostics.

The connector registry must distinguish:

- Implemented and tested.
- Planned.
- Experimental.
- Disconnected or not configured.
- Unavailable.

A connector appearing in the UI does not mean it is installed,
connected, or working.

Note the two different meanings of "connector" in this document:

- **NEURAL OS connectors:** adapters inside NEURAL OS that bring data
  into the app (for example the Obsidian vault importer).
- **Claude's plugins and connectors:** tools that Claude Code itself
  uses (MCP servers, plugins, skills). NEURAL OS can display their
  observable status but does not install or run them (section 10).

## 9.2 Integration candidates

The following were discussed as possible integrations. None are
confirmed as already connected.

| Integration | Intended role | Initial status |
|---|---|---|
| Claude / Claude Code | Primary monitored AI development environment; event source | First integration target |
| Obsidian | Import the user's existing vault; notes, wikilinks, folders | **High priority** (user has a vault) |
| GitHub | Repositories, version-control context, commits, project references | Planned |
| VS Code | Development environment and workspace context | Planned |
| MCP ecosystem / MCP servers | External tools Claude can use; show connected tool metadata where observable | Planned architecture |
| OBS Studio | Recording/streaming status and media-project context | Planned |
| Figma | Design files and creative project references | Planned |
| Browser / research tools | Research activity and source references where observable | Planned |
| Blender | 3D project references and workflow status | Future |
| DaVinci Resolve | Video-editing project references and workflow status | Future |
| FFmpeg | Media-processing task metadata, where integrated | Future |
| APIs | Extensible connections to external services | Framework / future |
| Shopify and business tools | Store/commerce context where explicitly connected | Future |

Do not label any of these as "already installed."

**Prioritization rule:** after Phase 0, Claude inspects what the user
actually has installed and uses (Claude Code plugins, MCP servers,
desktop apps) and proposes an ordered connector list with reasons. The
user approves or changes the order. Obsidian comes first after the core
unless the user decides otherwise.

## 9.3 Obsidian relationship

NEURAL OS replaces Obsidian for the user (section 5.9). It works without
Obsidian installed.

The user already has an Obsidian vault of about 80 GB, used for Roblox
game development, which Claude Code edits continuously. It is linked in
place (section 5.1, linked folders) as part of Phase 2.

Vault linking:

- Read Markdown files and folder structure.
- Link in place, read-only and watched (section 5.1). Show file count,
  size, and the indexing plan before starting. Copying small vaults
  stays possible as an option.
- Keep wikilinks (`[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`) and
  turn them into graph links.
- Build backlinks.
- Keep frontmatter and tags as metadata.
- Import attachments (images, PDFs) referenced by notes, where the
  format is supported.
- Skip the `.obsidian` configuration folder, but optionally read it for
  attachment-folder settings.
- Report broken links and unsupported files clearly.
- Never write to the vault unless the user turned on editing for it;
  then follow the safe write rules in section 5.1.
- Changes are picked up automatically through file watching.
- Render Obsidian-flavored Markdown correctly (section 5.9), so vault
  notes look right.

## 9.4 MCP clarification

MCP is a tool-integration protocol, not a passive activity monitor.
Connecting an MCP server does not reveal every action Claude performs.

Use Claude Code hooks or another documented event source for passive
activity monitoring. Use MCP only where it is really needed for a
supported connector or an explicit tool integration. Do not confuse
"Claude can call an MCP tool" with "NEURAL OS can observe all Claude
activity."

# 10. Plugin & Connector Readiness Check

## 10.1 Purpose

Before Claude starts a larger task, it checks which plugins, skills,
and connectors the task needs, whether they are available and working,
and what is missing. It asks the user before adding anything. Claude
must never claim results from a tool it could not use.

Example: the user gives Claude a task that involves GitHub and Figma.
Claude first checks both connections. GitHub works, Figma is missing.
Claude says so, suggests the matching connector, explains why and what
access it needs, and waits. It does not claim to have analyzed the
designs.

## 10.2 Two layers

This feature has two separate parts, and the document must keep them
apart:

| Layer | What it is | Who carries it out |
|---|---|---|
| A. Working rule | A behavior rule for Claude, stored in Claude Code's global instructions. It applies to all of the user's Claude Code projects. | Claude, inside Claude Code |
| B. Visualization | NEURAL OS shows the observable parts of the check: tool calls, results, the final readiness report. | NEURAL OS |

NEURAL OS never performs the check itself and never installs plugins.
It only ships the rule (opt-in) and visualizes what becomes observable.

## 10.3 When the check runs

The check runs before a task that:

- involves an external service, app, or account (for example GitHub,
  Figma, OBS, Notion, a browser, an API), or
- is expected to touch more than a few files, or
- the user explicitly calls a "big" task or asks for a check.

It does not run for short questions, single small edits, or pure
conversation. A short check (a few seconds of listing what is
available) is better than none when unsure.

## 10.4 The check procedure (Claude's behavior)

1.  **Identify needs.** List the services, data sources, and tool types
    the task requires.
2.  **Inventory.** Check what is available in the current session:
    loaded tools, configured MCP servers and their connection state,
    enabled plugins and skills. Use the discovery tools that Claude Code
    actually offers. Do not guess.
3.  **Compare.** Mark each need as: available and working / available
    but needs sign-in / failed to connect / missing.
4.  **Search.** For anything missing, search the available plugin and
    connector catalogs for a fitting option.
5.  **Report.** Before starting work, give a short readiness report:
    - what is ready,
    - what is missing, the suggested plugin or connector, and why,
    - what permissions or access it would need,
    - alternatives (another tool, a manual step, or a reduced scope).
6.  **Ask.** Ask the user before every installation, connection, or
    sign-in. One approval covers one item only. Sign-ins and passwords
    are always done by the user.
7.  **Verify.** After the user adds something, test it with a harmless
    read-only call. Report whether it works.
8.  **Proceed or reduce scope.** If something stays unavailable, do only
    the parts that are possible and say clearly which parts were not
    done and why.

## 10.5 How the rule is shipped with NEURAL OS

The user wants the rule to come automatically with NEURAL OS. To keep
the user in control, "automatically" means **offered by default during
setup, installed only after confirmation**:

- During first launch (Flow A), NEURAL OS shows the rule text and offers
  to install it. The checkbox may be pre-selected, but nothing is
  written until the user confirms.
- Installation target: the user-level Claude Code instructions, so the
  rule applies to every project. Verify the correct file and location
  for the installed Claude Code version on Windows and macOS (for
  example a global `CLAUDE.md` in the user's Claude configuration
  folder).
- Write the rule as a marked block, for example between
  `<!-- NEURAL-OS:READINESS:BEGIN v1 -->` and
  `<!-- NEURAL-OS:READINESS:END -->`. Never change text outside the
  block. Back up the file first.
- Updates to the rule (new versions) are shown as a diff and applied
  only after confirmation.
- Settings has a toggle to remove the rule. Removing it deletes only the
  marked block.
- Uninstalling NEURAL OS offers to remove the block.
- The rule must work without NEURAL OS running. It is plain Claude
  behavior. Only the visualization needs NEURAL OS.

During Phase 0, also evaluate shipping the rule as a Claude Code plugin
(for example instructions plus hooks in one package). Choose whichever
mechanism Claude Code officially supports best. Document the choice.

## 10.6 Visualization in NEURAL OS

Only show what is actually observable:

- Discovery and installation tool calls that hooks report (for example
  plugin or connector searches) appear as events and as a short scan
  animation across the Connectors region of the brain (section 4.5).
- Each connector or plugin seen in the check can appear as a node with
  its state: ready, needs sign-in, failed, missing, suggested.
- The final readiness report can be captured if Claude writes it in a
  stable, machine-readable form (Appendix A asks for a short marker
  line). If it is not captured, show "readiness report not available"
  instead of rebuilding it from guesses.
- A Readiness Checks panel lists past checks per session and project:
  time, needs, results, user decisions, verification results.
- Claude's internal reasoning about which tools it needs is not shown.
  Only its stated report and its tool calls are shown.

## 10.7 Limits

- Which plugin, connector, and discovery tools exist depends on the
  user's Claude Code version and account. Verify them in Phase 0.
- Some steps may not be visible to hooks at all. Document which steps
  are visible and which are not.
- The rule is an instruction, not a hard guarantee. Claude follows it
  as part of its instructions. NEURAL OS can show when a check was
  observed, but must not claim a check happened if no event confirms
  it.

# 11. Additional system modules

## 11.1 Overview

- Overall application status.
- Active project.
- Active Claude Code sessions, if detected.
- Recent activity.
- Library summary (file count, size).
- Connector status.
- Readiness rule status (installed / not installed / outdated).

## 11.2 History

- Searchable event timeline.
- Filter by session, project, event type, tool, and date.
- Link events back to files and graph nodes.
- Configurable retention and clear-history controls.

## 11.3 System Health

- Local receiver status.
- Hook installation status per platform.
- Desktop application status.
- Storage and indexing status.
- Connector health.
- Recent errors.
- Resource usage only where reliable and available.

## 11.4 Security and permissions

- Show which folders or integrations have been granted access.
- Make permissions understandable.
- Allow the user to disconnect integrations.
- Avoid broad file-system access by default.
- Clearly separate read-only access from write access.
- Keep NEURAL OS read-only toward monitored Claude project files.
- List every Claude Code file change NEURAL OS made (hooks, readiness
  rule, memory and instruction file edits), with an undo for each
  (section 3.4).

## 11.5 Evolution / change log

This module shows changes to NEURAL OS itself:

- Installed application version.
- Feature changes.
- Connector changes.
- Indexing or schema migrations.
- Readiness rule version and install history.
- User-visible configuration changes.

It must not suggest that NEURAL OS rewrites or improves its own code. No
self-modifying agent behavior is part of the scope.

The module explains itself at the top, because the name alone is
unclear: it is the change log of NEURAL OS itself, not of Claude and
not of the user's projects; NEURAL OS never changes itself, every
change comes from an update or from the user, and changes to Claude
Code files can be undone in the Security module. Below that it shows
growth over time (linked files and connectors) as small sparklines,
built only from recorded history.

# 12. Data architecture

Prefer a local-first design.

Logical components:

1. Desktop UI and 3D visualization layer.
2. Knowledge library and file-import subsystem.
3. Content extraction and indexing subsystem.
4. Graph and relationship store.
5. Local event receiver / bridge.
6. Event normalization and history store.
7. Connector registry and adapters.
8. Claude Code configuration manager (hooks, readiness rule, memory and
   instruction file edits; backup, install, remove).
9. Settings, permissions, and diagnostics.

The project starts from an empty repository. Claude chooses the
technologies in Phase 0 and justifies the choice. Hard requirements for
that choice:

- One codebase for Windows and macOS.
- Real-time 3D rendering with thousands of nodes.
- Local database and file access.
- A local HTTP or IPC endpoint for the event receiver.
- Signed, installable builds for both platforms (in Phase 7).

Typical candidates are a web-technology desktop shell (such as Electron
or Tauri) with a WebGL/WebGPU 3D library, but this is not a fixed
decision.

## 12.1 Data entities

- `Project`
- `FileAsset` (library copy, original path, hash, size, import date)
- `KnowledgeNode`
- `KnowledgeEdge`
- `Tag`
- `ClaudeSession`
- `ActivityEvent`
- `ReadinessCheck` (needs, inventory results, user decisions,
  verification results)
- `Connector`
- `ConnectorPermission`
- `ConfigChange` (what NEURAL OS wrote to Claude Code files, with
  backup reference)
- `NoteVersion` (version history per note)
- `LinkSuggestion` (suggested link, reason, status: open, accepted,
  rejected)
- `ContextPack` (selected notes and files, created date)
- `ApplicationSetting`

Keep source file metadata separate from extracted content and graph
relationships. Use stable IDs and schema versions. Provide migrations
for future schema changes.

## 12.2 Storage

- Local database for structured metadata, graph links, and event
  history.
- Library folder holding copies of imported files.
- Derived cache for extracted text, previews, and indexes.
- Explicit retention controls for activity logs.
- No cloud sync or telemetry by default.
- Default locations follow platform conventions (for example the user's
  application data folder on Windows and Application Support on macOS).
  The library folder location is chosen by the user at first launch.

# 13. Privacy and security requirements

Privacy is a core product requirement.

- Local-first operation.
- No telemetry or cloud upload by default.
- No collection of private Claude reasoning.
- Do not store full prompt text or file contents in activity logs by
  default.
- Never collect or reuse Claude login tokens, subscription credentials,
  cookies, or private authentication data.
- Use supported integration mechanisms and documented permissions.
- Request access only when needed.
- Protect local event endpoints.
- Sanitize paths and untrusted metadata before rendering.
- Treat file contents and connector responses as untrusted data.
- Never execute content from imported files.
- Make export, deletion, retention, and disconnect behavior explicit.
- Provide clear diagnostics without leaking secrets.
- Changes to Claude Code configuration follow section 3.4.
- **Recording/privacy mode:** one shortcut replaces file paths, file
  names, project names, and note excerpts on screen with generic labels
  ("File A", "Project 1"), for screen sharing, screenshots, and
  recordings. Activity animations keep working.

## 13.1 Token cost of using NEURAL OS

Using NEURAL OS costs **no Claude tokens**: the app contains no AI and
never calls a model. All analysis (search, OCR, link suggestions) runs
locally without a model.

The only effects on Claude's token use:

- **Monitoring hooks:** zero, because hooks are silent (section 6.3).
- **Readiness rule:** the rule text (about 400 tokens) is loaded into
  each Claude Code session, and the check itself costs a few thousand
  tokens, only before larger tasks.
- **Context packs:** used well, they can reduce token use, because
  Claude gets exactly the needed notes instead of searching for them.

Any future feature that would call a model must be opt-in, show its
expected cost, and be discussed as a separate decision.

# 14. User experience flows

## Flow A --- First launch

1.  Show a short welcome screen.
2.  Explain that NEURAL OS is a knowledge workspace and live activity
    monitor, not an AI agent. Three short cards: *Collect your
    knowledge* (link an Obsidian vault, import folders, drop files; the
    brain grows with the library), *Watch Claude work* (live files,
    tools, skills, subagents, connectors), *Claude uses your knowledge*
    (the library is a plain Markdown folder that Claude Code can read
    like any folder the user allows, or the user hands over a context
    pack; NEURAL OS sends nothing by itself). Then the "what it is not"
    note.
3.  Let the user choose the library folder.
4.  Offer an optional Obsidian vault import or folder import.
5.  Offer Claude Code monitoring setup (hooks) as a separate opt-in
    step. Show the exact change.
6.  Offer the Plugin & Connector Readiness rule as a separate opt-in
    step. Show the rule text and where it will be written.
7.  Show the main brain interface.

## Flow B --- Import a file

1.  User drops a file or selects it with the file picker.
2.  NEURAL OS validates the format and access.
3.  NEURAL OS checks for duplicates by hash.
4.  The file is copied into the library.
5.  Metadata and supported text are extracted.
6.  A knowledge node is created and appears in the 3D graph.
7.  The Library panel count updates.
8.  Clicking the node opens a readable detail panel.

## Flow C --- Explore a knowledge node

1.  Hover shows a compact preview.
2.  Click opens the full detail panel.
3.  The user can inspect content, metadata, tags, project, and
    connections.
4.  Selecting a linked node flies the camera to it.
5.  The user can return to the previous focus or reset the view.

## Flow D --- Claude Code activity

1.  User enables the Claude Code integration.
2.  NEURAL OS installs the hooks at user level after explicit approval.
3.  Claude Code keeps working normally.
4.  A supported event arrives at the local receiver.
5.  NEURAL OS validates and stores the event.
6.  The activity appears in the timeline.
7.  The related project or file node lights up if it can be identified.
8.  The user can click the event to inspect its observable details.

## Flow E --- Connector setup (NEURAL OS connectors)

1.  User opens Connectors.
2.  User sees connector status and required permissions.
3.  User chooses a connector and reviews its capabilities.
4.  User explicitly authorizes configuration.
5.  NEURAL OS tests the connection.
6.  The UI shows connected, disconnected, error, or planned status
    accurately.

## Flow F --- Readiness check during a Claude task

1.  The user gives Claude a larger task in Claude Code.
2.  Claude runs the readiness check (section 10.4).
3.  Observable discovery calls appear in NEURAL OS as events and a scan
    across the connector region.
4.  Claude reports what is ready and what is missing, and asks before
    adding anything.
5.  The user approves or declines each item inside Claude Code.
6.  Claude verifies new connections and then starts the task, or works
    with a reduced scope.
7.  NEURAL OS stores the check in the Readiness Checks panel, as far as
    it was observable.

# 15. Implementation roadmap

## Phase 0 --- Setup and feasibility audit

-   Confirm the repository is empty and set up the project structure.
-   Apply the readiness check to this project itself: list needed
    plugins and connectors (for example GitHub) and ask the user.
-   Check the current official Claude Code documentation and the
    installed version: hook events, payload fields, settings locations,
    plugin and connector discovery tools, global instruction file.
-   Test which hook events actually fire, on Windows and, if available,
    on macOS.
-   Choose the technology stack and justify it (section 12).
-   Propose the connector priority order (section 9.2).
-   Identify platform constraints.

**Deliverable:** short technical audit, verified event list, stack
decision, and implementation plan.

## Phase 1 --- Desktop shell and 3D visual foundation

-   Create the cross-platform desktop shell.
-   Implement the dark neutral design system.
-   Build the 3D brain: rotate, zoom, fly-through, focus, reset,
    orientation helper.
-   Build the functional regions (section 4.5), clickable and labeled.
-   Full-screen brain world with floating overlays, dock, status strip,
    and command palette (section 4.3).
-   Apply the clarity principle from the start (section 4.6).
-   Set up German/English localization from the start (section 0).
-   Implement idle and test activity animations using clearly labeled
    demo data.
-   Run on Windows and macOS.

**Deliverable:** navigable 3D prototype. Demo events must be labeled as
demo data.

## Phase 2 --- Knowledge library

-   File import with copy-to-library, duplicate detection, and import
    confirmation.
-   Library panel (count, size, file list).
-   Metadata extraction and previews for the first supported formats.
-   Graph nodes and explicit relationships in the 3D scene, with
    project clusters in the Memory region.
-   Note-taking core (section 5.9): editor, wikilinks, backlinks, tags,
    search, daily notes, templates, rename with link updates, version
    history, local graph, focus mode, outline, Obsidian-flavored
    Markdown compatibility.
-   Hover previews, click detail panels, search, filters.
-   Text extraction for PDF and DOCX (feature 7, without OCR yet).
-   Linked folders (section 5.1) and linking the user's vault (section
    9.3): read-only, watched, selective and incremental indexing,
    collapsed folder clusters.
-   Error handling and data-integrity protections.

**Deliverable:** usable local knowledge workspace that can replace
Obsidian for daily notes, with the user's vault visible and searchable.

## Phase 3 --- Claude Code event integration and readiness rule

-   Local event receiver.
-   Cross-platform hook installer at user level, with backup and
    removal.
-   Normalize verified events and persist history.
-   Stream events to the UI and connect them to nodes.
-   Final event-to-region mapping (section 4.5), documented.
-   Claude traces on notes (feature 1).
-   Session list and filter (section 6.7).
-   Readiness rule installer, updater, and remover (section 10.5).
-   Readiness visualization for observable steps (section 10.6).
-   Clearly show unsupported or unavailable fields.
-   AI change log (S1) and self-writing memory (S2), section 5.12.
-   First discoverability hints for S1 and S2 (section 4.7).

**Deliverable:** real, tested live monitoring, the AI change log, session
notes, and an installable readiness rule.

## Phase 4 --- Large-vault hardening

-   Test with the user's real 80 GB vault while Claude edits it
    (read-only for NEURAL OS).
-   Measure first-index time, memory use, and graph frame rate; fix
    bottlenecks.
-   Broken-link report and exclude-pattern editor.

**Deliverable:** the user's real vault runs smoothly and stays up to
date while Claude works in it.

## Phase 5 --- Projects, history, models, and diagnostics

-   Project grouping and project cockpit (feature 9).
-   Searchable history and filters.
-   Session replay (feature 2).
-   Claude's memory as notes (feature 3).
-   Context packs (feature 4).
-   Time slider (feature 5).
-   Local OCR (feature 7) and link suggestions (feature 8).
-   Readiness Checks and connector map (feature 10).
-   Model and subagent information where exposed.
-   System health and security/permission panels.
-   Configurable retention.
-   Context server (section 3.5) with the memory flash (S3).
-   Brain time-lapse export (S5).
-   Stream overlay (feature 12), stale-note warning (feature 13), daily
    recap (feature 14, optional).

**Deliverable:** reliable monitoring and overview experience; Claude can
ask NEURAL OS for context.

## Phase 6 --- Connector framework and further integrations

-   Connector registry and status model.
-   Further connectors in the order the user approved.
-   Do not present planned connectors as working.
-   Shareable brains (S4): export with review and filtering, import as a
    read-only foreign brain.

**Deliverable:** extensible, honest connector ecosystem and shareable
brains.

## Phase 7 --- Polish and release readiness

-   Performance for large graphs on both platforms.
-   Accessibility and keyboard navigation.
-   Packaging and code signing for Windows and macOS, updates, crash
    handling, diagnostics.
-   Backup/export and recovery.
-   Security review.
-   End-to-end tests on both platforms.

Public release requirements (the user plans to publish if the app is
good):

-   Code signing and notarization: an Apple Developer account for macOS
    and a code-signing certificate for Windows. These cost money; tell
    the user before this step.
-   Auto-update mechanism with signed updates.
-   License decision for the app (for example free, freemium, or paid)
    and a check of all third-party library licenses.
-   Name check: confirm "NEURAL OS" can be used as a product name
    (trademark search) before any public launch.
-   No implied affiliation: say "works with Claude Code"; never use
    Anthropic or Obsidian branding or suggest a partnership.
-   Onboarding for users who do not use Claude Code: the knowledge
    workspace must be fully useful without it.
-   Privacy policy stating local-first, no telemetry by default.
-   Crash reports only with explicit opt-in.
-   Launch plan from section 4.7: feature videos (in the app and for
    social media), public example brains.

**Deliverable:** stable desktop release candidate, ready for a public
release decision.

# 16. Testing and acceptance criteria

The application is not complete just because the UI looks convincing.

## Knowledge workspace

- A supported file can be imported, and the original stays unchanged
  (verified by hash).
- The library copy appears in the Library panel and the count is
  correct.
- Importing the same file twice does not create a duplicate.
- A node appears in the graph and has a stable identity.
- Hover preview and click detail view show the correct file.
- Extracted text is distinguishable from original source content.
- Links stay intact after renaming a node.
- Unsupported files fail clearly and safely.
- Search returns the expected files and flies to the correct node.
- A linked folder is never written to (verified by hashes before and
  after a session).
- A change made by another tool in a linked folder appears in NEURAL OS
  within seconds.
- Indexing a large linked folder runs in the background and the app
  stays responsive.
- A note can be created, edited, linked with `[[...]]`, and renamed;
  all links update.
- An edit can be undone through version history.
- The library folder opens correctly in a plain Markdown tool, with no
  NEURAL OS-specific markup inside the notes.

## Clarity

- On first launch, only the brain, dock, and status strip are visible.
- Every feature from section 5.10 can be reached in at most two clicks
  or through the command palette.
- Every feature can be turned off and then leaves no trace on the main
  screen.
- Switching between German and English changes all UI text, with no
  untranslated strings and no layout breaks.

## 3D brain

- The brain silhouette is recognizable from the front, side, top, and
  back.
- Rotate, zoom, fly-through, pan, focus, and reset work with mouse,
  macOS trackpad, and keyboard.
- The user can always get back to the default view.
- Inside the brain, near nodes fade and do not block the view.
- Frame rate stays smooth with the target node count on a typical
  laptop.
- Each event type lights up the documented region; unmapped events use
  the neutral pathway.
- Clicking a region opens its overlay.

## Claude monitoring

- A real supported Claude Code event reaches the local receiver.
- Events from two parallel local sessions are shown separately and can
  be filtered.
- The event is validated and stored.
- The UI shows the correct event type and timestamp.
- File and project linking works when reliable identifiers exist.
- Missing metadata is shown as unavailable, not guessed.
- No private chain-of-thought is displayed or claimed.
- Claude Code keeps working normally, without delay, when NEURAL OS is
  closed.
- Monitoring can be disabled cleanly, and the hook configuration
  returns to its previous state.

## Readiness check

- The rule is installed only after confirmation, as a marked block.
- Text outside the block is unchanged (verified by diff).
- Removing the rule deletes only the block.
- In a test task that needs a missing connector, Claude reports it and
  asks before adding anything.
- Claude does not claim results from a missing connector.
- Observable discovery steps appear in NEURAL OS. Unobservable steps
  are shown as not available.
- The rule still works when NEURAL OS is closed.

## Privacy and security

- The event receiver is not reachable from the network by default.
- No credentials or tokens are collected.
- File access is limited to granted folders.
- Original files are never deleted or overwritten.
- Logs do not expose sensitive contents by default.
- Connector permissions and connection states are visible.

## Visual quality

- Panels do not cover the whole brain.
- Idle animation is subtle.
- Active animation matches real events or is clearly labeled as demo
  data.
- The interface stays usable with many nodes and events.

# 17. Development instructions for Claude Code

You are building NEURAL OS from scratch. Treat this document as the
product specification, but first inspect the actual environment.

1.  **Run the readiness check first.** Before Phase 0, apply section
    10.4 to this project: which plugins and connectors do you need
    (for example GitHub for the repository)? Report and ask.
2.  **Audit before coding.** Confirm the repository state and the
    installed Claude Code version.
3.  **Do not start by building every connector.** Build the core
    architecture and working vertical slices first.
4.  **Verify external APIs and hook capabilities.** Use current official
    documentation for Claude Code and each integration. Do not invent
    hook names, payload fields, settings paths, or tool names.
5.  **Build for Windows and macOS.** The user has both and tests on
    both. After each phase, give the user a short test checklist per
    platform and state what you could not test yourself.
6.  **Separate real data from demo data.** Demo events must be visibly
    labeled and never mixed into real history.
7.  **Do not fake observability.** No simulated Claude thoughts or
    invented model or subagent details.
8.  **Keep NEURAL OS passive toward Claude's work.** It monitors. It
    does not execute Claude's tasks or install Claude's plugins.
9.  **Protect user files.** No destructive file operations, broad
    permissions, or silent overwrites. Configuration writes follow
    section 3.4.
10. **Build in steps.** After each phase, run relevant tests and report
    what passed, what failed, and what is still unverified.
11. **Be transparent.** If a requirement is impossible or unsupported by
    the current APIs, explain the limit and propose the smallest safe
    alternative.
12. **Keep configuration explicit.** Document environment variables,
    permissions, local ports, hook setup, readiness rule setup, and
    recovery steps.
13. **Do not claim completion without testing.**

At the start, return:

- Readiness check result for this project.
- Environment audit.
- Proposed architecture and stack, with reasons.
- Verified Claude Code event and hook coverage.
- Risks and open questions.
- A phased implementation plan.

Then implement Phase 1 and Phase 2 as the first meaningful milestone.

# 18. Open questions

Resolved questions are listed in section 0. Still open:

- **Exact technology stack:** decided in Phase 0.
- **Exact Claude Code hook events, payload fields, settings paths, and
  plugin discovery tools** for the installed version: verified in
  Phase 0.
- **Delivery mechanism for the readiness rule:** global instruction
  file block or Claude Code plugin: decided in Phase 0 (section 10.5).
- **File formats beyond the initial list.**
- **Optional cloud sync:** default remains local-only. Not planned.
- **Canvas, table, and Kanban views:** after the first milestone; order
  to be decided.
- **Plugin API for NEURAL OS:** important for a public release; design
  after the core is stable.
- **Mobile app or companion:** not planned; revisit before public
  release.
- **Other AI coding agents** (besides Claude Code) as event sources:
  revisit before public release.
- **`.brain` file format details** (manifest fields, versioning,
  licence field) and whether imported brains can be updated: Phase 6.
- **Brain marketplace:** if and how brains are exchanged publicly;
  separate decision with privacy and licensing review.

Deliberately excluded (discussed and rejected to keep the core idea):
an own AI model, autonomous task execution, a model router, a
self-modifying "evolution engine", and visualizing Claude's "thinking".
A field that sends tasks to Claude may be reconsidered later only as a
separate, explicit decision.

# 19. Final product definition

NEURAL OS is a dark, immersive desktop application for Windows and
macOS, built around a rotatable 3D neural brain.

The brain fills the whole screen; everything else floats above it. The
user writes notes and adds files, which live in a local Markdown library
and become connected nodes in the brain's Memory region. Hovering shows
a preview. Clicking opens the content, metadata, and relationships. The user can rotate the brain, zoom in,
and move through its inside. Claude Code keeps working in its normal
environment. Real events from all local Claude sessions are received
locally and shown in the same network. Before larger tasks, Claude
checks which plugins and connectors it needs and asks before adding
any. NEURAL OS shows what of that is observable.

> **Your knowledge becomes the network. Claude's observable work
> activates it. NEURAL OS gives you the overview.**

------------------------------------------------------------------------

# Appendix A --- Readiness rule text (v1)

This is the block NEURAL OS offers to install into the user's global
Claude Code instructions. It must work on its own, without NEURAL OS.

``` markdown
<!-- NEURAL-OS:READINESS:BEGIN v1 -->
## Plugin & connector readiness check

Before starting a larger task, check whether you have the tools it needs.

A larger task is one that involves an external service, app, or account
(for example GitHub, Figma, OBS, Notion, a browser, an API), or is
expected to touch more than a few files, or that the user calls big or
asks you to check. Skip the check for short questions, single small
edits, and conversation.

Procedure:
1. List the services, data sources, and tool types the task needs.
2. Check what is actually available in this session: loaded tools,
   configured MCP servers and their connection state, enabled plugins
   and skills. Use the discovery tools you have. Do not guess.
3. Mark each need as ready, needs sign-in, failed to connect, or missing.
4. For anything missing, search the available plugin and connector
   catalogs for a fitting option.
5. Before starting, give a short readiness report: what is ready, what
   is missing and what you suggest and why, what access it needs, and
   alternatives.
6. Ask before every installation, connection, or sign-in. One approval
   covers one item. The user does all sign-ins.
7. After something is added, test it with a harmless read-only call and
   say whether it works.
8. If something stays unavailable, do only what is possible and say
   clearly what was not done and why. Never claim results from a tool
   you could not use.

End the readiness report with one line in this exact form, so that
monitoring tools can read it:
READINESS: ready=<comma list> missing=<comma list> needs_signin=<comma list> failed=<comma list>
<!-- NEURAL-OS:READINESS:END -->
```
