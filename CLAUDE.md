# HTT AI Hub Team Tree

Work only in this independent HTT project. Do not edit the personal Command Center.

Before private Google Drive work, verify the connected account is the HTT Google account using the connector's account/profile tool. A browser profile is not proof. Stop private Drive operations on an identity mismatch. Read the current HTT AI Hub Registry and relevant instructions before using its files. Do not substitute personal Command Center instructions or Drive files.

Preserve the supplied design and functions. No emojis. Meagan is CEO. Senior Analyst sits to her right and reports directly to her. Lauren and Cristina are peer managers beneath Senior Analyst; each has an unassigned assistant/employee tile. Categories are alphabetical and editable.

Hosting choice: Netlify. Shared database choice: Neon Postgres. Do not use Supabase. This source is currently an offline/browser-local preview; do not describe it as shared or authenticated.

Before production, implement server-side authenticated reads/writes with explicit approved membership for Meagan, Lauren and Cristina; deny anonymous access and unauthorized edits. Keep Neon credentials in server-only environment variables. Use optimistic concurrency/version checks to prevent overwriting simultaneous edits, durable history/backups, and server-side validation of graph cycles, links and payload limits. Browser localStorage is not shared storage. Verify signed-out denial, unauthorized-account denial, cross-device persistence, conflicting edits and restore before release.

Use an HTT-owned Git repository, Netlify team and Neon project where practical. Git is recommended for version history and transfer, not required to view this prototype. Keep infrastructure separate from any Claude login so changing to Meagan's future work Claude account does not require rebuilding the app. Preserve SQL schema/migrations, JSON export/import and an environment-variable inventory for portability.

The generic Senior Analyst introduction is in documents/. Upload/convert it into a native Google Doc in HTT AI Hub only after verifying the connector. Verify saved content and actual file URL, then replace the tile's local download URL. Do not invent a Drive link or change sharing without scoped authorization.

Do not publish, deploy, connect production credentials, change live Command Center files or alter sharing until scoped approval. A Senior Analyst Ready finding does not provide release approval. Only CEO approval can terminate a project, with alternatives and consequences first.

Current category memberships are listed in README.md. Andrea is a peer manager with title unconfirmed. Cristina is Executive Assistant. There are NO category owners or owner lanes. Render categories in one alphabetical horizontal row with Add member selecting existing people or assistants. Store membership IDs as a many-to-many relationship, separate from reporting lines. Never duplicate a person record to assign them to another category.

Latest approved design direction: build out compact category rows beneath each Team Member. Omit the section person's own name from their cards; show other assigned people. Team Members are humans; AI Assistants are typed AI profiles. Use Add Employee and Add AI Assistant separately. Only AI names may link to introduction files. Open positions are not presumed to be either type. See the current README, which supersedes earlier visual-trial notes.

Latest presentation: remove unused default blank positions beside Lauren and Cristina. Render assigned employees and AI assistants as compact connected name bubbles. EE background #d0c7d5, AI background #6e5f7a, both white text. AI role-document links are labeled Profile separately from the name, superseding the earlier name-link instruction. Human employees have no Profile links. Keep Senior Analyst beside Meagan.

Latest user revision supersedes earlier styling and personnel: remove Andrea; retain Client Care unassigned. EE bubbles use #d0c7d5 with #3b2f45 text for readability. AI bubbles retain #6e5f7a with white text.

Add Skill is a category-level UI action, not an automatic skill installation. Persist skill id/name/optional HTTPS URL/description in the shared category record; validate and migrate old records with empty skills. Skill bubbles are separate from typed people profiles. Top name tiles use lavender #d0c7d5 and dark plum #3b2f45 text.

Current structure supersedes earlier prototypes: one category-under-person view. Remove Grouped/Reporting mode switches. Show is a viewing filter. All editing, addition, assignment, category removal, global deletion, and skill editing must use the right-hand Team editor with explicit Save. Use labeled checkboxes for memberships, never native multi-select. Newsletter is unassigned from Lauren; preserve it as an available category. Preserve the same storage key and IDs. Rebuild editor callbacks after rollback while retaining drafts; carry category person context when creating a profile. See current README.md and review-notes.md.

Preserve Add Artifact as a second-line category action. Its right-panel editor stores name, optional HTTPS URL and description under category.artifacts. Include artifacts in server validation, migrations, shared persistence and revision history. The Show selector is All Team plus human employees only. Close belongs beside Cancel and Save in editor footers.
