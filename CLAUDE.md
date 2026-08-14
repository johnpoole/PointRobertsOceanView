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

The rest of what this project is, and the standing instructions on how to write
for it, are in [CONTINUE.md](CONTINUE.md). Read it before working here.
