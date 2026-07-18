---
name: iknowdesign
description: Use when designing, redesigning, art-directing, polishing, or faithfully implementing expressive public-facing web experiences such as landing pages, marketing sites, portfolios, editorial pages, and brand-led product surfaces, especially when the result risks feeling generic, visually incoherent, weakly hierarchical, or unlike its reference.
license: MIT
compatibility: Designed for coding agents with repository access and optional browser, screenshot, image-comparison, and package-inspection tools.
metadata:
  author: leonxlnx
  version: "1.0.0"
---

# Iknowdesign Skill

Create web experiences with a specific point of view, disciplined visual grammar, and rendered evidence. This skill optimizes design quality. It does not own backend logic, project management, migrations, or generalized engineering work.

## Design Standard

A strong design is **relevant, legible, coherent, memorable, and truthful**. It gives the audience the right feeling while making the next action obvious. Decoration is useful only when it strengthens meaning, hierarchy, trust, or delight.

Use this authority order:

1. The user's outcome, constraints, audience, and supplied truth.
2. Existing brand, content, product behavior, design tokens, and repository conventions.
3. Supplied screenshots, Figma frames, URLs, imagery, and named visual systems.
4. Accessibility, platform conventions, performance, and responsive usability.
5. This skill's defaults.

Never overwrite a real brand with fashionable defaults. Never invent testimonials, awards, customer logos, metrics, product screenshots, or capabilities to make a composition feel complete.

Use this skill for public-facing and narrative web surfaces. Do not use it as the primary workflow for dense admin tools, spreadsheet-like interfaces, native apps, game HUDs, or nonvisual bug fixes.

## Design Workflow

### 1. Read the real design problem

Inspect only evidence that can change the design decision: audience, content, proof, brand assets, current render, component system, typography, imagery, responsive behavior, interaction states, and supplied references.

Write a compact **design premise**:

```text
Audience: [who must understand or act]
Job: [what they need to believe, find, or do]
Desired feeling: [specific emotional register]
Domain and decision context: [what kind of decision this surface supports]
Trust mechanism: [what earns belief here]
Dominant content object: [product, story, place, data, person, work, or action]
Expected density and tempo: [how compact and how paced]
Proof form: [what real evidence matters]
Domain cliché: [the default visual shortcut to avoid]
Content truth: [facts, proof, assets, constraints]
Visual tension: [the useful contrast that creates character]
Preserve: [brand, routes, content, behavior]
Avoid: [brief-specific clichés or risks]
Evidence: [desktop, mobile, states, source comparison]
```

The premise must be specific enough that it would not fit an unrelated company after swapping the logo.

## Domain Lens

Before art direction, identify the domain and decision context, trust mechanism, dominant content object, expected density and tempo, proof form, imagery role, interaction expectation, and domain cliché to avoid. These are design inputs, not a template. A finance comparison, hospitality reservation, editorial story, and developer-tool proof page should not inherit the same hierarchy merely because all are websites.

Use [domain and content archetypes](references/domain-and-content-archetypes.md) when domain trust, density, proof, or imagery should materially change the visual system. When a surface spans domains, assign one dominant lens to each content job and preserve shared brand grammar across them.

### 2. Separate content jobs

Map every section or screen region to one job: orient, explain, prove, compare, demonstrate, convert, or close. Remove sections that repeat a job without adding evidence. Write copy and layout together; hierarchy cannot rescue empty content.

### 3. Set observable design completion

```text
Visible outcome: [what changes]
Critical states: [desktop, mobile, hover, focus, loading, error, empty]
Preserved truth: [brand, copy, routes, events, product behavior]
Comparison target: [reference, premise, or existing design]
Acceptance evidence: [screenshots, interaction, build, accessibility]
```

Source inspection alone never proves visual completion.

## Visual Direction Gate

When no strong visual target already exists, generate **three distinct directions** before broad implementation. They must differ in composition, typography character, color/material behavior, imagery role, and interaction tempo—not merely accent color.

For each direction, state:

```text
Name:
Premise connection:
Composition model:
Typography character:
Palette and material:
Imagery treatment:
Signature move:
Risk:
```

Choose the direction that best serves the audience, content truth, and desired feeling. Show the options when the user requests exploration or approval; otherwise compare them internally and proceed with the strongest defensible route.

A **signature move** is one memorable decision rooted in the subject: a distinctive crop, navigation behavior, typographic contrast, spatial reveal, diagram language, or material treatment. Use one primary signature move and at most one supporting motif. A pile of trends is not a point of view.

Reject a direction when:

- it could be relabeled for an unrelated product without meaningful change;
- it depends on fake proof or decorative UI jargon;
- its novelty harms comprehension or conversion;
- mobile requires deleting the idea rather than recomposing it;
- it uses a style label without a content-based reason.

Read [direction and originality](references/direction-and-originality.md) when the first ideas feel interchangeable. Directions must be orthogonal across at least four axes—composition, typography, palette/material, imagery, interaction tempo, or content voice—rather than superficial variants.

## Anti-Template Gate

Before broad implementation and again before handoff, run a **section-formula inventory**, **component-anatomy repetition** audit, **silhouette diversity** test, content replacement test, generic-hero check, and **motif budget**. Repetition is valid when it supports comparison, family, rhythm, or interaction meaning. It fails when unrelated content jobs are forced into identical cards or section formulas.

Use [anti-template and specificity](references/anti-template-and-specificity.md) to distinguish intentional consistency from generic sameness and domain mismatch. Fix the content model and composition before changing decoration.

## Design Grammar

Lock one coherent answer for each axis before multiplying the page.

### Composition

Define focal order, grid, container behavior, section rhythm, alignment, asymmetry, depth, edge pressure, and whitespace distribution. Use the **squint test** to confirm focal order and the **thumbnail test** to confirm that major masses remain distinct at reduced scale. Vary sections because their content jobs differ, not to satisfy an arbitrary novelty quota.

### Typography

Choose display and reading roles, scale, measure, weight, line height, tracking, casing, numerals, and control text. Test real wrapping at target widths. A beautiful font choice with weak line breaks, tiny controls, or inconsistent optical weight is failed typography.

### Color and material

Define neutral temperature, foreground hierarchy, accent role, semantic colors, borders, shadows, gradients, texture, and surface depth. Run a **grayscale test**: hierarchy must remain understandable without hue. Use saturation as emphasis, not wallpaper.

### Imagery and art direction

Specify subject, camera or illustration logic, crop, focal point, lighting, background, aspect ratio, treatment, and sequence. Use fewer stronger images rather than many generic decorations. Product and brand imagery must remain truthful and consistent.

### Shape and detail

Choose one radius family, border language, icon family, shadow model, and control geometry. Repetition should make the system feel intentional; exceptions must communicate hierarchy or state.

### Voice

Visible copy, labels, proof, and calls to action must sound like the actual organization. Remove generic premium language, fake system labels, filler pills, and unearned claims.

Load the focused references for the active axes instead of importing every design rule at once.

### Prove a vertical slice

Render the navigation or shell, first viewport, one representative downstream section, one meaningful state, and the same slice on mobile. Fix premise, hierarchy, typography, color, imagery, and component boundaries before repeating the system.

## Responsive Recomposition

Responsive design is not proportional shrinking. Preserve the audience's priority while changing composition deliberately.

For each breakpoint decide:

- what remains first, what moves, what collapses, and what disappears;
- whether imagery crops, swaps, stacks, or becomes background;
- how headline wrapping and reading measure change;
- which interactions become touch-native;
- how density, navigation, proof, and calls to action adapt.

Run a **content stress test** with longer headings, longer labels, missing media, empty data, validation errors, and translated-length copy. The layout must fail gracefully rather than depend on perfect demo content.

Read [responsive composition](references/responsive-composition.md) for mobile hierarchy and breakpoint evidence.

## Interaction and Motion

Design default, hover, focus, active, selected, disabled, loading, empty, error, success, and destructive states where relevant. States must change more than color when meaning or accessibility requires it.

Motion must clarify orientation, feedback, continuity, causality, progress, or emphasis. Keep a complete static baseline. Use one motion language, support interruption and rapid repeat, and preserve meaning under `prefers-reduced-motion`. Use the standalone `motion-design` skill when choreography is a primary deliverable.

Read [interaction and states](references/interaction-and-states.md) for state anatomy and [motion-design](../motion-design/SKILL.md) only when motion is consequential.

## Design Quality Gate

Use `assets/design-quality-rubric.json` after the first representative render and before handoff. Score eight dimensions from 0–5. Passing requires:

- no hard-stop defect;
- no dimension below 3;
- at least 32/40 overall;
- rendered desktop and mobile evidence;
- direct **source-to-render comparison** when a visual target exists.

Run these fast perception checks:

1. **Squint test:** focal order and grouping remain obvious.
2. **Grayscale test:** hierarchy does not depend on color alone.
3. **Thumbnail test:** large-scale composition remains recognizable.
4. **Five-second test:** audience, offer, and primary action are inferable quickly.
5. **100th-viewing test:** repeated motion and decorative effects do not become irritating.
6. **Content stress test:** realistic variation does not break the system.
7. **Brand-removal test:** the page still carries subject-specific character after hiding the logo.

For a supplied reference, compare source and render at the same viewport and state. Inspect at least five concrete points covering composition, typography, color, imagery, spacing, states, or responsive behavior. Do not claim fidelity from code alone.

Hard stops include clipped primary content, unreadable text, broken focus, mobile overflow, fabricated proof, generic placeholder imagery, mismatched icon language, default-browser control typography, repeated card-template sections, inaccessible contrast, missing critical states, or an unverified fidelity claim.

For consequential work, use the read-only `iknowdesign-critic` after implementation. Use `iknowdesign-art-director` before implementation when the premise is clear but the visual route is weak. Read [critique and fidelity](references/critique-and-fidelity.md) for the full review format.

## Implementation Discipline

- Preserve existing framework, routes, events, behavior, and design tokens unless change is explicit.
- Reuse strong repository primitives; remove weak decoration before adding components.
- Keep semantic HTML, keyboard access, focus visibility, zoom, touch targets, contrast, and reduced motion intact.
- Use real assets and accurate aspect ratios. Do not replace visible reference assets with crude CSS approximations.
- Keep component families coherent and use explicit variants instead of copied one-off styling.
- Verify desktop, mobile, key states, console, build, and touched interactions.
- Fix one causal visual layer at a time, then recapture the same evidence.

## Output Contract

Lead with the design outcome, not process narration. Include:

```text
Design premise:
Chosen direction and signature move:
System decisions: [composition, type, color, imagery, responsive, interaction]
Evidence: [source/render paths, viewports, states, checks]
Rubric: [dimension scores and hard-stop result]
Preserved constraints:
Remaining caveats:
```

Use a concise evidence ledger:

| claim | visual or runtime evidence | status |
|---|---|---|
| [important design result] | [screenshot, comparison, interaction, build] | verified / caveat / blocked |

Never describe a design as polished, faithful, accessible, or responsive when the corresponding rendered evidence was unavailable.

## Reference Loading

| Active design question | Reference |
|---|---|
| Domain trust, density, proof, content archetype | [domain-and-content-archetypes.md](references/domain-and-content-archetypes.md) |
| Premise, direction, distinctiveness | [direction-and-originality.md](references/direction-and-originality.md) |
| Template repetition and subject specificity | [anti-template-and-specificity.md](references/anti-template-and-specificity.md) |
| Grid, hierarchy, spacing, section flow | [composition-and-rhythm.md](references/composition-and-rhythm.md) |
| Font roles, scale, measure, wrapping | [typography.md](references/typography.md) |
| Palette, contrast, surfaces, depth | [color-and-material.md](references/color-and-material.md) |
| Photography, illustration, crop, asset system | [imagery-and-art-direction.md](references/imagery-and-art-direction.md) |
| Breakpoints and mobile priority | [responsive-composition.md](references/responsive-composition.md) |
| Controls, feedback, loading, errors | [interaction-and-states.md](references/interaction-and-states.md) |
| Rubric, comparison, critic handoff | [critique-and-fidelity.md](references/critique-and-fidelity.md) |
