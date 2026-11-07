---
name: thread
description: Startet eine Nebenaufgabe als eigenen Claude-Thread in cmux, mit eigenem Git-Worktree und eigenem Workspace in der Projektgruppe der Sidebar. Nutze den Skill, wenn der User eine Aufgabe parallel, nebenbei oder getrennt bearbeiten lassen will, oder wenn du selbst eine unabhängige Nebenaufgabe erkennst und der User zustimmt. Trigger: „mach das als Thread", „neuer Thread", „parallel", „nebenbei", „mach das in einem eigenen Worktree", „spawn", „fork das ab", „Thread aufräumen", „Thread ist fertig". Nur innerhalb von cmux (Env CMUX_WORKSPACE_ID gesetzt) und in einem Git-Repo.
---

# Thread in cmux starten

Ein Thread ist ein eigener Workspace in der cmux-Projektgruppe. Er hat einen eigenen Worktree unter `.claude/worktrees/<slug>` auf Branch `aufgabe/<slug>` und ein eigenes Claude. Bei pnpm-Projekten mit `dev`-Script laufen daneben Browser und Dev-Server auf einem freien Port.

## Starten

1. Prüfe `echo $CMUX_WORKSPACE_ID`. Leer heißt: nicht in cmux. Sag das und hör auf.
2. Wähle einen Slug: 2 bis 4 Wörter, kebab-case, nur `a-z0-9-`, z. B. `filter-bug`.
3. Schreib einen eigenständigen Startauftrag. Das neue Claude kennt dieses Gespräch nicht. Nenne Ziel, betroffene Dateien, bekannte Fakten, Akzeptanzkriterien und „Committe auf deinem Branch, kein Push, kein Merge".
4. Starte im Repo:
   ```sh
   cmux-aufgabe <slug> --beschreibung '<einzeiler>' --prompt '<startauftrag>'
   ```
   Die Beschreibung steht in der Sidebar unter dem Thread-Namen: max. 6 Wörter, was der Thread tut, z. B. „Design-System auf Restseiten".
   Optional `--von <branch>`, wenn der User eine andere Basis will. Default ist der aktuelle Branch des Haupt-Checkouts.
5. Antworte in einer Zeile: Thread-Name, Branch, Port. Der Fokus bleibt hier; der User wechselt selbst, wenn cmux meldet.

Mehrere Threads auf einmal: pro Aufgabe ein Aufruf.

## Aufräumen

Nur auf ausdrücklichen Wunsch des Users („Thread X ist fertig", „räum X auf").

1. Prüfe mit `git -C .claude/worktrees/<slug> status --short`, ob alles committet ist. Sonst sag es und hör auf.
2. Schließe den Workspace: `CMUX_QUIET=1 cmux close-workspace --workspace <ref> --force`. Den Ref liefert `cmux tree --all`, Workspace-Name = Slug.
3. `cmux-aufgabe fertig <slug>` entfernt Worktree und Branch. Ein ungemergter Branch bleibt stehen; sag das dem User.

## Orchestrieren

Threads melden sich selbst. Der Mod `threads` schickt am Ende jedes Thread-Turns dessen letzte Antwort per `cmux agent message` an die Session, die den Thread gestartet hat (`cmux-aufgabe` merkt sie sich in `<git-dir>/threads-parent`), sonst an die Session des Haupt-Checkouts. Sie kommt als Nachricht von `[Thread <slug>]` an und weckt die Main-Session, auch wenn sie ruht. Abschalten pro Rechner: `THREADS_REPORT=0`.

Die Main-Session ist dann Orchestrator. Der User soll nur sie beobachten müssen.

1. **Lesen:** Ist der Thread fertig, fragt er etwas, oder meldet er nur einen Zwischenstand? Reine Bestätigungen brauchen keine Antwort.
2. **Selbst beantworten,** was Issue, Projektregeln (CLAUDE.md, Memory, Skizzen-Regeln) oder eine frühere Entscheidung des Users hergeben. Antwort an den Thread per `SendMessage` an seinen Session-Namen (`ListAgents`, Name beginnt mit dem Slug) oder `cmux agent message <workspace> "<text>"`.
3. **Zum User eskalieren,** was Geschmack, neue Daten- oder Inhaltsentscheidungen, Kosten, Rechte, Deploys oder Fremd-PRs betrifft. Fragen sammeln, gebündelt vorlegen. Der betroffene Thread wartet, die anderen laufen weiter.
4. **Fertige Threads reinbringen** nach den Regeln des Repos: PR oder lokaler Merge steht in CLAUDE.md oder Memory, nicht im Skill. CI vor dem Merge prüfen (Exit-Code von `gh pr checks`, ohne Pipe). Danach Thread aufräumen, wenn die Regeln es erlauben.
5. **Nächsten Schritt starten,** wenn der Plan im Issue ihn vorsieht (z. B. nächste Welle als neue Threads). Threads nicht selbst pushen oder PRs anlegen lassen, das macht die Main-Session in der geplanten Reihenfolge.
6. **Kurz berichten:** Pro Ereignis ein, zwei Sätze an den User. Was offen ist und ihn braucht, zuerst.

Grenzen: Keine Regel des Repos umgehen (z. B. Branch-Schutz mit `--admin`). Wird etwas blockiert, anhalten und den User fragen.

## Zurückmergen

Nur auf ausdrücklichen Wunsch („merge Thread X", „merge X zurück"). Läuft im Haupt-Checkout, nicht im Thread: Der Zielbranch ist dort ausgecheckt, ein Worktree kann ihn nicht auschecken.

1. Prüfe, dass Thread-Worktree und Haupt-Checkout sauber sind (`git status --short`). Sonst sag es und hör auf.
2. Im Haupt-Checkout: `git merge --no-ff aufgabe/<slug>`. Bei Konflikten: `git merge --abort`, Konfliktdateien nennen, aufhören.
3. Danach auf Wunsch aufräumen (siehe oben). „Merge und räum auf" heißt beides.

Wird ein Thread im eigenen Workspace gebeten zu mergen: Er antwortet, dass der Merge im Haupt-Workspace des Projekts läuft, und bietet `git rebase <zielbranch>` im Thread an, falls der Zielbranch weitergelaufen ist.

Pushen oder PRs gehören nicht zum lokalen Zurückmergen. Ob ein Repo PRs nutzt, steht in seinen Regeln (siehe Orchestrieren).
