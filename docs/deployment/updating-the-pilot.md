# Updating the pilot server (Kigali Mac)

**This replaces the old seven-step instructions.** If you have the old
PDF with seven steps, do not use it any more — everything it did (and
more) now happens with one command that checks itself.

## What you need

- The **update folder** we sent you (a folder named `bimoto` with the
  new version inside). Put it anywhere — the Desktop is fine. Do not
  put it inside the installed `bimoto` folder.
- Five quiet minutes. Riders cannot use Bimoto while the server is
  stopped, so pick a calm moment.

## The update, in three moves

1. **Stop the server.** Go to the Terminal window where the server is
   running, hold the **Control** key and press **C** once. Wait until
   it says it has stopped.

2. **Run the updater.** Open the update folder, then the `scripts`
   folder inside it, and double-click **`update-pilot.command`**.
   A Terminal window opens and talks you through everything. Read what
   it says — it speaks plain English and never does anything silently.

   > If macOS complains that the file "cannot be opened", right-click
   > (or Control-click) the file and choose **Open**, then **Open**
   > again. If that still fails, open Terminal yourself and run:
   >
   > ```
   > sh ~/Desktop/bimoto/scripts/update-pilot.command
   > ```
   >
   > (adjust the path to wherever you put the update folder).

3. **Start the server when asked.** Near the end, the script shows you
   the exact two lines to run in a Terminal window — the same way you
   always start the server. After you start it, press Enter in the
   updater window and it checks that the new version really runs and
   that the database is connected. It says **UPDATE VERIFIED** when
   everything is good.

That is the whole procedure.

## Things the script refuses to do — and why

The script checks everything **before** touching anything. If a check
fails it stops, tells you which one and what to do, and nothing has
been changed. It refuses when:

- the update folder is incomplete or damaged;
- it cannot find the installed app;
- you accidentally ran the copy of the script inside the installed app
  instead of the one in the new update folder;
- the tools it needs (`node`, `pnpm`) are missing or too old;
- it cannot find your settings file (`.env`);
- **the server is still running** — stop it first (Control+C);
- the database is not answering.

## Your settings are safe

Your settings file (`.env`) is **never** replaced, edited or shown on
screen. The script carries it into the new version unchanged and
double-checks the copy is identical, byte for byte. If the new version
knows about a setting your file does not have yet, the script lists the
setting's **name** (never a value) and lets you decide whether to
continue or stop and ask us.

## If something goes wrong

The script fixes it itself: it keeps the old version aside during every
update (it is moved, never deleted), and if any step fails after the
swap it **puts the old version back** and tells you so. You end up on
the version that was running before, with your settings untouched. The
message on screen tells you exactly which file to send us — please send
it, it is how we see what happened.

If you closed the updater window too early, just run the script again —
it picks up where it left off (it will not update twice by accident; a
finished-but-unchecked update resumes at the final check instead).

## If the script itself will not run

Very unlikely, but if double-clicking does nothing and the `sh` command
above prints nothing at all, you can still get back to a working state,
because nothing has been changed until the script says so:

1. Start the server the usual way:

   ```
   cd ~/bimoto/packages/server
   pnpm dev
   ```

2. Tell us what happened. The old version keeps working; there is no
   hurry and nothing is broken.

If an update had already half-happened, folders named
`bimoto.previous.…` sit next to the `bimoto` folder — those are the
kept old versions. Do not delete them; tell us and we will walk you
through restoring one (it is a single rename).

## Questions the script may ask you

- **"New settings found..."** — the update knows about a setting your
  file does not have. Usually fine to continue; if we told you a new
  setting is needed for this update, stop and add it first.
- **"A server answered, but it has been running since BEFORE the
  update"** — an old server window is still open somewhere. Stop the
  server in **every** Terminal window (Control+C), start it once,
  fresh, and let the script check again.
