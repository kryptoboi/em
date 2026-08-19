# Editing `index.html` in VS Code, deploying to `gs://emores` via GitHub

**End result:** you open the folder in VS Code, edit `index.html`, hit commit + push,
and ~30 seconds later the file on your bucket is updated. No console clicking, no drag-and-drop.

You only do steps 1–5 once. After that, only step 6 matters.

---

## Step 1 — Get the current `index.html` onto your computer

In the Cloud Storage browser tab you have open:

1. Find the `index.html` row.
2. Click the **⋮** menu at the far right of that row → **Download** (*Pobierz*).
3. Save it somewhere sensible, e.g. `Documents/emores-site/`.

Do this *before* anything else — the copy in the bucket is the source of truth right now,
and you don't want to overwrite it with an older version later.

## Step 2 — Set up the local folder

Unzip `emores-site.zip` (the scaffold I sent) into the same place, so you end up with:

```
emores-site/
├── index.html                    <- the file you downloaded in step 1
├── .gitignore
├── SETUP.md
└── .github/
    └── workflows/
        └── deploy.yml
```

Then, in a terminal:

```bash
cd path/to/emores-site
git init -b main
git add .
git commit -m "Initial commit: index.html from gs://emores"
```

> The `.github` folder starts with a dot, so it's hidden in Finder/Explorer.
> It will show up fine in VS Code.

## Step 3 — Create the GitHub repo and push

1. Go to <https://github.com/new>.
2. Name it `emores-site`. Set it to **Private** (recommended — it's your live site's source).
3. **Do not** tick "Add a README", "Add .gitignore", or "Choose a license". You need an empty repo.
4. Click **Create repository**, then run (swap in your username):

```bash
git remote add origin https://github.com/YOUR-USERNAME/emores-site.git
git push -u origin main
```

If Git asks for a password, it wants a **personal access token**, not your account password —
easiest fix is to let VS Code handle it: open the folder in VS Code, click the Source Control
icon in the left bar, and use **Publish Branch**, which signs you in through the browser.

## Step 4 — Create a service account so GitHub can write to your bucket

This is the "key" GitHub uses to upload. It is scoped to *only this bucket*.

**4a. Create the account**

1. Console → **IAM & Admin** → **Service Accounts** → **Create service account**.
2. Name: `github-deploy`. Click **Create and continue**, then **Skip** the optional role step
   (you'll grant the role on the bucket instead, which is tighter), then **Done**.
3. Copy the email it generated — it looks like
   `github-deploy@project-4010577e-246a-46aa-be6.iam.gserviceaccount.com`.

**4b. Give it access to just the `emores` bucket**

1. Console → **Cloud Storage** → bucket **emores** → **Permissions** (*Uprawnienia*) tab.
2. **Grant access** → New principals: paste the service account email.
3. Role: **Storage Object User** (`roles/storage.objectUser`). Save.

**4c. Create the key**

1. Back in **Service Accounts**, click `github-deploy` → **Keys** tab → **Add key** →
   **Create new key** → **JSON** → **Create**.
2. A `.json` file downloads. Treat it like a password. Do **not** put it in the project folder.

## Step 5 — Give the key to GitHub

1. Your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**.
3. Name: `GCP_SA_KEY` (exactly this — the workflow looks for that name).
4. Secret: open the downloaded `.json` in a text editor, select all, paste the **entire**
   contents including the outer `{ }`.
5. **Add secret**. Now delete the `.json` file from your Downloads folder — GitHub has it,
   and you can always generate a new one.

---

## Step 6 — Your day-to-day loop

```bash
code path/to/emores-site      # or just open the folder in VS Code
```

Edit `index.html`. When you're happy:

- **In VS Code:** Source Control panel (`Ctrl+Shift+G`) → type a short message → **Commit** → **Sync/Push**.
- **Or in the terminal:**
  ```bash
  git add index.html
  git commit -m "what I changed"
  git push
  ```

Then open the **Actions** tab on GitHub. You'll see a run appear; green tick = deployed.
Refresh your site (`Ctrl+Shift+R` for a hard refresh) and the change is live.

To check it went through without GitHub:
<https://storage.googleapis.com/emores/index.html>

---

## Things worth knowing

**Caching.** The workflow sets `Cache-Control: no-cache` on `index.html`, so browsers re-check
it every time and your edits show up immediately. Without this, GCS defaults to caching HTML
for an hour and you'd be staring at a stale page wondering why nothing changed.

**Public access is preserved.** Your bucket grants public read at the *bucket* level, so a
re-uploaded `index.html` stays publicly readable automatically. Nothing to re-do per upload.

**The bucket is still the live copy.** If you ever edit `index.html` directly in the console,
your local repo goes out of date — the next push will silently overwrite that console edit.
Pick one place to edit (the repo) and stick to it.

**Undo a bad deploy.** `git revert HEAD && git push` re-uploads the previous version. If you
want belt-and-braces, turn on **Object Versioning** on the bucket so old copies are retained.

**Adding more files later.** To also deploy `privacy-policy.txt`, `thumbs/`, etc., add them to
the repo and change the upload step in `.github/workflows/deploy.yml` to:

```yaml
      - name: Sync site to gs://emores
        run: |
          gcloud storage rsync . gs://emores \
            --recursive --exclude='^\.git.*' --cache-control="no-cache, max-age=0"
```

and widen the `paths:` filter at the top (or remove it).

**If the workflow fails**, click the failed run in the Actions tab and open the red step:

| Error contains | Fix |
| --- | --- |
| `credentials_json` / `invalid_grant` | The secret isn't valid JSON — re-paste the whole file contents. |
| `403` / `does not have storage.objects.create` | Step 4b didn't take. Re-check the role on the bucket. |
| `secrets.GCP_SA_KEY` is empty | Secret name typo, or it was added to the wrong repo. |
