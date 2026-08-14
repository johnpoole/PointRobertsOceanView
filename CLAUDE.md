# CLAUDE.md — Point Roberts ocean view

## Deploy every change. Do not ask.

A change is not finished when it is edited, and not when it is pushed. It is
finished when it is running on the server. Commit, push, deploy, confirm — as
the last step of the work, without being asked, every time.

```
git push origin main
ssh basement 'cd ~/pointroberts-oceanview && git pull --ff-only && docker compose build && docker compose up -d'
```

Run it inline and show the output. The build takes a couple of minutes.

Confirm from the server, not from this machine: the house has no hairpin NAT and
`oceanview.johnpoole.ca` always times out from inside it.

```
ssh basement 'docker ps --filter name=oceanview --format "{{.Status}}" && curl -s -o /dev/null -w "%{http_code}\n" localhost:8091/'
```

## Do the named change and nothing else

No files he did not ask for, no flags, no refactors, no words he did not use.
The boat is "it". If something else looks wrong, say it in one sentence at the
end and leave it alone. If he answers a question or declines something, it is
closed — do not raise it again.

## Never end a turn on a question he has already answered

He gives an instruction, and the reply states a decision and then asks
permission for the decision it just stated. He is often away from the machine,
so that does not cost a minute, it stops the work until he next looks. Ask only
when a wrong guess would waste real work or cannot be undone. Otherwise state
the assumption in one line and keep going.

## Say what a slow step costs before starting it

The headless Chromium here has no GPU and rasterises this scene at about three
seconds a frame, so one page load and one screenshot is minutes. Two of them is
most of a coffee. Say so before starting, and report between runs rather than
going silent.

And ask whether it is worth it. Geometry is settled by arithmetic against the
baked heightmap, exactly and in a second. The browser only ever answers "does it
run" and "does it look right".

The rest of what this project is, and the standing instructions on how to write
for it, are in [CONTINUE.md](CONTINUE.md). Read it before working here.
