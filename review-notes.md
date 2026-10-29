# Editor structure review

Scope: isolated HTT preview, using the local Sterling role brief. Review by a separate reviewer. Final verdict: Ready for this preview revision. This does not authorize deployment.

Findings addressed:
1. Native multi-select required undisclosed Ctrl/Cmd-clicks and could replace other memberships. Replaced with labeled checkboxes and explicit Save in the right panel. Newsletter removal from Lauren survived reopening while Marketing and Social Media remained.
2. Grouped/Reporting/View team/editor selection disagreed about scope. Removed alternate view controls. Show is a viewing filter; Editing identifies the actual panel target. Close, Cancel, person and category selection are explicit.
3. Inline fields, prompts and dialogs spread editing across surfaces. All edits now use the right panel, including profile creation, existing-person assignments, category rename/removal and skills.

Follow-up findings addressed:
- Rollback formerly detached objects referenced by save handlers. Failed saves now rebuild the panel and restore draft values; correcting an invalid AI Profile URL saved successfully without losing the draft. Temporary title was restored after testing.
- Creating from a category while viewing Everyone formerly assumed Meagan. Category context now carries the visible person. Verified Marketing under Lauren creates a draft reporting to Lauren; draft canceled without creating a profile.

Other UI checks: skill save/reopen/remove in the panel; preserved original Profile URL; Newsletter remains available as an unassigned category; single-view controls; shared HR membership unchanged. Temporary checks were removed.
