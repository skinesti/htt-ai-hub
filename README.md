# HTT AI Hub · Team Tree

Local preview: http://127.0.0.1:5407/ while the local preview server is running. Development source: index.html and app.js. Standalone HTML copies embed the same script; keep documents/ alongside them for the Senior Analyst Profile download.

## Current structure and editing

There is one category-under-person view. Show is only a viewing filter: Everyone, Meagan, Lauren, Cristina or an AI assistant. Grouped/Reporting mode switches have been removed. Person cards and category names are selections, not inline text fields. All editing happens in the right-hand Team editor. The Editing selector chooses a person, category or skill independently of the viewing filter. Close and Cancel leave unsaved form changes unapplied; Save updates the tree. Changing the shown person closes the editor.

Person editor: name, title, type, reporting manager, optional additional manager, AI-only Profile URL, and labeled checkboxes for category assignments. Unchecking one category removes only that person's assignment. Category editor: name, assigned-people checkboxes, skills, Remove from the shown person only, and a separate clearly labeled Delete category everywhere section. Skills are edited in the same panel. Add EE/Add AI opens an existing-person assignment form with a separate Create new profile action; it does not silently create duplicates. Creating from a category carries the visible person's manager context. General creation in Everyone starts with no manager. Every save validates graph cycles, references, links and payload limits.

Newsletter has been removed from Lauren; Marketing and Social Media remain. Newsletter still exists as an unassigned category, accessible in the editor and in Everyone. Client Care is also unassigned. Meagan retains Business Operations, Clinical Supervision, Finance, Human Resources and Insurance. Cristina retains Admin, Human Resources and Web Site, with Executive Assistant as her title. Andrea and unused default positions have been removed. Senior Analyst is an AI assistant reporting directly to Meagan, displayed beside her with an arrow toward Meagan.

Shared category appearances refer to one record. People have one profile and may belong to many categories. Reporting and category assignments are separate; neither grants data access. A person's own name is omitted from their own category cards; other members appear as connected name bubbles.

## Appearance

Top name tiles: branded lavender #d0c7d5 with dark plum #3b2f45 text. EE bubbles: #d0c7d5 with #3b2f45 text. AI bubbles: #6e5f7a with white text. AI-only Profile links lead to role descriptions. Skills use separate connected Skill bubbles with optional links. Category buttons remain Add EE, Add AI, Add Skill on one line. Categories remain alphabetical and horizontal, with scrolling at narrow widths.

## Saving and review

This is browser-local, with no shared sign-in or Neon connection yet. The save key remains htt-ai-hub-horizontal-members-v4; the filter preference uses its -view suffix. A raw pre-migration browser snapshot is retained once under the -before-panel-editor suffix. Source backups are in .backups/pre-panel-editor/. JSON export/import preserve the same model, existing IDs, memberships, typed profiles, skills, manager relationships and Profile URLs. Undo restores changes from the current session. A failed save rolls back data, rebuilds editor handlers against restored records, and preserves draft fields for correction.

A separate Sterling-style reviewer used the local role brief and returned Ready for this preview revision after two fixes. See review-notes.md. This is not release approval or a claim that the installed Sterling assistant executed a live cross-chat workflow.

## Netlify + Neon handoff

Read CLAUDE.md before development. The chosen stack is Netlify + Neon; no Supabase. Do not publish this local preview as a public substitute for a private shared app. Implement authenticated server-side authorization for every read/write, approved membership, server-only database credentials, schema migrations, immutable revisions, optimistic concurrency/conflict handling, and backup/restore. Verify anonymous and unauthorized denial, cross-device persistence, conflicting edits and restore before approved release. Store profile IDs and category membership relationships; preserve the current UI and single editing panel.

Use HTT-owned Git, Netlify and Neon projects when approved. Git is recommended for review, rollback and future ownership transfer, not needed to view this local prototype. Keep ownership separate from the Claude account so Meagan's future work account can use the same app. No repository, database, authentication provider or deployment has been provisioned.

## Drive and role document

Before private HTT Drive work, verify connector identity is the HTT Google account and read the current HTT AI Hub Registry and relevant instructions. The last verified connector was cmprocto@gmail.com, so no shared native Google Doc was created. Generic DOCX, HTML and Markdown role descriptions are in documents/. After correct verification, upload/convert into Google Docs in HTT AI Hub, verify content and actual URL, then configure Senior Analyst's Profile URL. Application membership does not grant Drive access. Do not invent links or change sharing without scoped authorization.

No deployment or personal Command Center changes have been made. This remains an isolated preview for user review.

## Latest additions

Show lists All Team plus human employees (currently Meagan, Lauren and Cristina); AI assistants appear within teams rather than as viewing options. The editor footer has Close, Cancel and Save. Add Artifact is a second-line category action below Add EE / Add AI / Add Skill. Artifacts store id, name, optional HTTPS link and description in category.artifacts, independently from category.skills. They appear as connected Artifact bubbles and are created, edited, moved between categories and removed in the right panel. Artifacts persist in browser save and JSON backups; older records migrate with an empty artifacts array. This is a linked artifact record, not a file-upload or hosting service.
