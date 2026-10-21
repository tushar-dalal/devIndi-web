# Store records and automatic refunds

What this sets up:

- **A private copy of every Lemon Squeezy order and license key** in Supabase, shown on
  **Admin › Orders** (`admin/orders.html`) with search, totals, CSV export and an activity log.
- **Automatic key disabling:** when an order is **fully** refunded, its license key is disabled
  through the Lemon Squeezy API, so Shotly stops working at its next check. Partial refunds
  (e.g. a goodwill discount) are recorded but leave the key working.

```
Lemon Squeezy ──(signed webhook)──► lemon-webhook ──► store_orders / store_license_keys / store_events
                                         │
                                         └─ full refund ──► Lemon Squeezy API: disable the key
admin/orders.html ──(your admin email + password)──► admin-orders ──► reads the tables
```

**Privacy:** unlike the analytics tables, these hold buyers' names and emails, so the public
key in `analytics/config.js` can't read them. Only the two functions can, using Supabase's
service-role key, which never leaves Supabase. Full license keys are never copied, only the
short form (`XXXX-…-ABCD`).

## One-time setup (about 15 minutes)

### 1. Create the tables
Supabase › **SQL Editor** › New query › paste all of `supabase-store-setup.sql` › **Run**.

### 2. Make a webhook secret
Any long random string. To make one, run this in PowerShell and copy the result:

```
-join ((48..57)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

### 3. Create a Lemon Squeezy API key
Lemon Squeezy › **Settings › API** › create a key named "Supabase". (Keys made in test mode
only see test orders. Make a live one when you go live.)

### 4. Add the secrets to Supabase
Supabase › **Edge Functions › Secrets** › add:

| Name | Value |
|---|---|
| `LEMON_WEBHOOK_SECRET` | the secret from step 2 |
| `LEMON_API_KEY` | the key from step 3 |
| `ADMIN_LOGIN_HASH` | the `EXPECTED_HASH` value in `admin/index.html` |

### 5. Create the two functions
Supabase › **Edge Functions** › **Deploy a new function** › **Via editor**:

1. Name it **`lemon-webhook`**, replace the sample code with all of
   `functions/lemon-webhook/index.ts`, and deploy.
2. Do the same for **`admin-orders`** with `functions/admin-orders/index.ts`.
3. For **both**, open the function's **Settings** and turn **off** "Enforce JWT verification"
   (Verify JWT). Lemon Squeezy can't send a Supabase token, and the admin function does its own
   password check.

### 6. Point Lemon Squeezy at it
Lemon Squeezy › **Settings › Webhooks** › **+**:

- **Callback URL:** `https://pbrcuqgqtuivxmuyrujo.supabase.co/functions/v1/lemon-webhook`
- **Signing secret:** the secret from step 2
- **Events:** `order_created`, `order_refunded`, `license_key_created`, `license_key_updated`

Do this once in **test mode** now, and again in live mode when you go live.

### 7. Check it works
1. Make a test purchase (card `4242 4242 4242 4242`).
2. Open **Admin › Orders** on devindi.in, confirm your admin email and password. The order is there.
3. Refund it in Lemon Squeezy. Click **Refresh**: the order shows *refunded*, the key shows
   *disabled*, and the Activity list says "Key … disabled after the refund".
4. **Sync from Lemon Squeezy** copies every order and key across at any time, in case a
   notification was ever missed (or for orders from before this was set up).

## Good to know

- If a step fails (say the API key expired), the Activity list shows it in red with
  "disable it by hand", and Lemon Squeezy retries failed notifications.
- The admin password check runs on the server, but the hash in `admin/index.html` is public,
  so keep the admin password long and unique.
- Tests (simulated Lemon Squeezy and Supabase): `node --test store/functions/functions.test.ts`
