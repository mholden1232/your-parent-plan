YOUR PARENT PLAN — PAID USER PASSWORD VAULT BUILD

WHAT THIS BUILD ADDS
- A real Plus membership entitlement table in Supabase.
- Free users are blocked from vault data by database Row Level Security.
- Plus users can open a new Password Vault page.
- Each vault entry is encrypted in the browser with AES-GCM before it is sent to Supabase.
- The encryption key is derived from a separate vault passphrase using PBKDF2.
- The vault passphrase itself is NOT stored.
- Add / edit / delete / show / hide / copy password controls.
- A reusable membership.js foundation for gating other Plus features later.

UPLOAD TO GITHUB
Replace:
- information.html
- pricing.html
- styles.css

Add:
- vault.html
- vault.js
- membership.js

Keep your existing:
- supabase-config.js
- auth.js
- script.js
- photo files

SUPABASE STEP
After the GitHub upload, run:
supabase-paid-vault-setup.sql
in Supabase > SQL Editor.

TESTING A PLUS USER
The SQL file includes a commented TESTING ONLY update at the bottom.
Replace YOUR_TEST_EMAIL with your test account email and run that UPDATE.
Then sign out/sign back in and open:
Essentials > Password Vault.

IMPORTANT
Payment checkout is not connected in this build. The database entitlement is real,
but testing Plus status is activated manually in Supabase until Stripe/payment checkout
is connected in the next payment build.

VAULT PASSPHRASE
The vault passphrase cannot be recovered because it is not stored.
For a production launch, add a deliberate vault reset/recovery workflow before broad use.
