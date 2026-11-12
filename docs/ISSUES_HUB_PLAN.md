# Issues hub and Plans

Agreed with the owner and built 2026-10-27 (`dock/wa-79-issues-import-system`). How the code works is in CLAUDE.md.

## The idea

It works like Linear. A small group usually has **one project** ("Website application"); issues live in a project. **Plans** are
goals inside it ("Custom Auth Roles"): an issue can be put in a plan, or created from the plan's page, and still lives in its
project. **Each person sees their own work first**: the hub opens on My issues; a plan lists its unassigned issues to pick up;
the sprint shows who is doing what.

| Linear | Calsko |
|---|---|
| Workspace | Group |
| Team (key `ENG-12`, cycles, labels) | Project (key `WA-12`, sprints, labels) |
| Project (a goal) | Plan |
| Cycle / Favorites | Sprint / Starred |

Rule of thumb: a new **project** is for different people, code or sprints; a new **plan** is a new goal for the same people.

## Decided

1. Every issue lives in a project; its number, labels and sprint come from there.
2. A plan is optional and assigned to an issue like a label: at most one per issue.
3. Plans are group-level: everyone in the group sees them, anyone can create one (the creator leads it), one plan can span projects.
4. Plans have no labels or sprints of their own.
5. Your own work first is about what screens show, not a permission: everyone in a project can still open its issues.
6. The sidebar keeps its Projects section; its **Issues** item is the hub (issues across projects, plans, sprints, views, import).
7. **Starred** (issues, plans, views, My issues, workspaces) sits under the group's Settings in the sidebar, replacing Pinned.
8. Dropped for now: issues in a plan before any project exists, and turning a plan into a project.

## Plan files

Files has a group-wide **Plans** folder with one folder per plan, named and renamed with it. A plan starts with a **Brief** doc
(its description) and a **Whiteboard**. Everyone in the group edits them; plan folders can't be renamed, moved or deleted by hand.
Deleting a plan deletes its folder and everything in it, after a warning; its issues stay, without a plan.

## Design

- `plans`: `team_id`, name, description (TipTap), lead, status (Not started / In progress / Paused / Done / Canceled), start and
  target dates. Group members read and create; the lead and group owners/admins edit and delete.
- When an issue in a plan enters In Progress or In Review, a Not started plan automatically becomes In Progress. Other plan
  statuses are not changed automatically.
- `issues.plan_id`: the plan must be in the issue's group (`check_issue`). Plan property, filter, group-by and chip on issues.
- Plan page: description, progress, **Up for grabs** (unassigned open issues with Assign to me), issues by person, New issue.
- Hub tabs: **My issues** (default), **Plans**, **Sprints** (the current one grouped by person), **Views**. Import moved here:
  Linear projects become plans (matched by name), labels stay labels, cycles become sprints.
