# Release continuation

The original requirements are `COMPLAINTS.md` and `PLAN-VTE-REMEDIATION-ROADMAP` in agent-memory. `PHASE-VTE-M7` records the current acceptance state and exact tested revision. This operational HANDOFF is retained and excluded from the old deletion check by the user's explicit authorization.

## Release gates

1. Confirm that M7 records a green full software gate for the current committed revision. Until that record exists, this is still remaining software work. Use a fresh isolated checkout and `bun install --frozen-lockfile`. The repository's pre-push hook runs `just test-push`, which has the same logic-test prerequisite and Mocha command as `just test`; use that as the full gate when publishing, rather than running both. Record the SHA, results and artifact paths in M7. Supersede the already-closed GitHub issue #3 with a pointer to that published implementation and evidence, explicitly retaining the physical gate. Preserve the user's unrelated `AGENTS.md` edit and `.agents`/`.hermes` symlinks.
2. **The user will run the physical-tablet session.** Exercise the actual pen/finger workflows: drawing and erasing, constrained line/square drawing and axis movement, curve selection/locking and point editing, properties and Repeat, palette/settings, Layers, and save/reopen. Check both orientations and panel placement. Reopening deliberately unlocks layers; their names, contents, order and visibility stay in TikZ source. Record the actual device/browser and result in M7.
3. After the physical gate passes, publish an immutable release pin at that tested revision with the standalone and qualification archives. Keep any uncompleted release steps explicit in M7.

If a physical test finds a defect, commit its red story first. Edit the fork in `.cache/tikz-editor`, batch changes, then run `just tikz-editor-patch` and `just update-tikz-editor-vendor` once for the batch. Fork `bun install` changes `bun.lock`; do not include that lock rewrite in the patch. During fixes run affected story batches; the full suite is the gate. A negative gesture assertion needs a positive baseline in the same story, and existing geometry needs Fit before its first gesture.

## Unscheduled observations carried from the original handoff

- Freehand fits can put two anchors very close together near each stroke end.
- Opening a floating panel does not automatically re-fit or recenter the view; Fit diagram accounts for its occupied area.

These observations are retained here; this pass does not claim they were separately remediated.
