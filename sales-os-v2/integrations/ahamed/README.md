# Morpheus Asset Exchange — Ahamed Platform Handoff

## Purpose

Ahamed's platform is **not** a second CRM.

Sales OS remains the canonical source of truth for prospects, research, asset status, approvals and sales activity.

Ahamed's platform is a dedicated production surface for asset work:

1. Saad or Yazeed creates/updates a prospect in Sales OS.
2. They press **Send asset request to Ahamed**.
3. Sales OS creates a scoped asset job with a frozen prospect/research snapshot.
4. Ahamed's platform lists that job as `queued`.
5. Ahamed opens the job, reads the brief/research and starts work.
6. Ahamed changes status to `in_progress`.
7. Ahamed submits one or more deliverables (preview/live link, repo, commit, notes, version).
8. The job automatically becomes `ready_for_review`.
9. Saad/Yazeed reviews it in Sales OS.
10. If approved, the Sales OS asset becomes `Built` and an early-stage prospect moves to `Asset ready`.
11. If changes are requested, the job returns to `in_progress` and Ahamed sees the review note.

## Security model

Ahamed receives a **scoped Asset Exchange API key**.

That key can only access:
- asset jobs assigned to Ahamed
- frozen research/brief data attached to those jobs
- deliverables for those jobs
- job notes
- job status updates

It cannot access:
- Gmail or Sales Inbox
- email drafts
- approvals
- commercial opportunity values
- unrelated prospects
- contacts outside the job snapshot
- Sales OS admin/member data
- pipeline editing
- sending email

Do not put the API key directly in public browser JavaScript.

Store it in the server-side environment for Ahamed's app, for example:

```
MORPHEUS_ASSET_API_KEY=ma_live_...
MORPHEUS_ASSET_API_BASE=https://viajmvbwpmkiqxjtgshv.supabase.co/functions/v1/sales-os-asset-exchange
```

A Vercel/Netlify/Cloudflare serverless function or a small backend proxy is enough.

## API base URL

```
https://viajmvbwpmkiqxjtgshv.supabase.co/functions/v1/sales-os-asset-exchange
```

Every request requires:

```
Authorization: Bearer <MORPHEUS_ASSET_API_KEY>
```

## Recommended platform screens

Ahamed can design these however he wants.

### Dashboard
Show:
- New / queued
- In progress
- Ready for review
- Approved
- Due soon
- Recently updated

### Job list
Each card should show:
- company
- job title
- priority
- status
- due date
- work type

### Job detail
Show:
- build request
- structured build brief
- prospect/category/location/website
- research notes and source links
- existing asset references
- deliverable requirements
- conversation / review notes
- current status

Actions:
- Start work
- Add note
- Submit deliverable
- Resubmit after changes

### Submit deliverable
Fields:
- title
- primary URL
- deployment URL
- repository URL
- repository commit
- version label
- notes
- asset type

Submitting automatically changes the job to `ready_for_review`.

## Status contract

Ahamed may set only:

- `queued`
- `in_progress`
- `ready_for_review`

Sales OS controls:

- `approved`
- `cancelled`
- `deployed` (future ops use)

Ahamed must never mark his own work as approved.

## Polling

The API returns `poll_after_seconds: 60`.

Recommended behavior:
- refresh on page open
- refresh when the user returns to the tab
- optionally poll every 60 seconds
- use `updated_since` to fetch changes efficiently

## Minimal fetch example

```js
const BASE = process.env.MORPHEUS_ASSET_API_BASE;
const KEY = process.env.MORPHEUS_ASSET_API_KEY;

async function morpheus(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

const { jobs } = await morpheus("/jobs?status=queued,in_progress,ready_for_review");
```

## Important architecture rule

Do not duplicate prospect/research data into a second permanent database unless needed for local cache.

The job payload from Sales OS is the authoritative work brief.

Ahamed's system should treat Sales OS job IDs as canonical IDs and push deliverables/status back through the Asset Exchange API.
