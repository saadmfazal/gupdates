# Zoho Mail bridge

Status: deployed integration code; owner OAuth registration/consent is required before a mailbox can connect.

## Authority rules

- Morpheus Sales OS remains the source of truth for prospects, stages, next actions, drafts and activity.
- Zoho Mail is a message provider. It does not overwrite canonical prospect identity or import unrelated mailbox content.
- Sync imports only messages whose counterpart exactly matches a saved prospect contact email.
- Sending remains human review-gated in the Outreach workspace.
- Provider credentials and refresh tokens are stored in Supabase Vault, never browser storage.

## Zoho API Console setup

Create a **Server-based Application** and register this callback exactly:

`https://viajmvbwpmkiqxjtgshv.supabase.co/functions/v1/sales-os-zoho-oauth`

Then sign in to Sales OS as Saad or Yazeed, open **Settings → Zoho Mail**, and enter the client ID and client secret. Choose the correct Zoho data centre and authorize the mailbox.

Requested least-privilege scopes:

- `ZohoMail.accounts.READ`
- `ZohoMail.folders.READ`
- `ZohoMail.messages.READ`
- `ZohoMail.messages.CREATE`

## Components

- Migration: `supabase/migrations/20261005_sales_os_zoho_mail.sql`
- OAuth: `supabase/functions/sales-os-zoho-oauth/index.ts`
- Matched-thread sync: `supabase/functions/sales-os-zoho-sync/index.ts`
- Review-gated send: `supabase/functions/sales-os-zoho-send/index.ts`

Gmail remains available and unchanged. Drafts can select Gmail or Zoho Mail when both are connected.
