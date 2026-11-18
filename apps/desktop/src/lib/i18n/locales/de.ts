import type { Catalog } from "../messages";

// German (Deutsch) — full translation of the en source. Keys mirror `en`
// exactly; ${…} placeholders are preserved verbatim.
export const de: Catalog = {
  "common.cancel": "Abbrechen",
  "common.confirm": "Bestätigen",
  "common.ok": "OK",
  "common.create": "Erstellen",
  "common.open": "Öffnen",
  "common.reset": "Zurücksetzen",
  "common.dismiss": "Verwerfen",
  "topbar.repoFallback": "Repository_name",
  "topbar.searchScope": "dieses Projekt",
  "topbar.settings": "Einstellungen",
  "topbar.account": "Konto",
  "topbar.back": "Zurück zu den Repositories",
  "search.placeholder": "Commits, Branches, Tags durchsuchen…",
  "search.noResults": "Keine Treffer",
  "search.scope.commits": "Commits",
  "search.scope.message": "Nachricht",
  "search.scope.author": "Autor",
  "search.scope.hash": "Hash",
  "search.scope.time": "Zeit",
  "search.scope.branch": "Branch",
  "search.scope.tag": "Tag",
  "search.placeholder.commits": "Commits durchsuchen…",
  "search.placeholder.message": "Commit-Nachrichten durchsuchen…",
  "search.placeholder.author": "Nach Autorname oder E-Mail suchen…",
  "search.placeholder.hash": "Nach Commit-Hash suchen…",
  "search.placeholder.time":
    "Nach Datum suchen, z. B. 2026-08 oder 2026-08-19…",
  "search.placeholder.branch": "Branches durchsuchen…",
  "search.placeholder.tag": "Tags durchsuchen…",
  "logAnytime.enable": "Log Anytime aktivieren",
  "logAnytime.desc":
    "Während die App geöffnet ist, wird dein Arbeitsverzeichnis in regelmäßigen Abständen auf einem dedizierten Branch gesichert — ein Sicherheitsnetz, zu dem du zurückkehren kannst.",
  "logAnytime.branch": "Log-Branch",
  "logAnytime.interval": "Snapshot alle",
  "logAnytime.minutes": "Minuten",
  "logAnytime.paidSection": "Hintergrundausführung & Komprimierung (Advance+)",
  "logAnytime.background": "Im Hintergrund ausführen",
  "logAnytime.periodicSquash": "Periodische Komprimierung",
  "logAnytime.autoPush": "Auto-Push",
  "logAnytime.locked": "Erfordert den Advance-Plan",
  "logAnytime.compactNow": "Jetzt komprimieren",
  "logAnytime.compacting": "Wird komprimiert…",
  "logAnytime.compactDone": "Log-Historie komprimiert.",
  "logAnytime.compactNoop": "Bereits komprimiert.",
  "logAnytime.compactFailed": "Komprimierung ist nicht verfügbar.",
  "logAnytime.noRepo":
    "Öffnen Sie ein Repository, um Log Anytime zu konfigurieren.",
  "crash.title": "Etwas ist schiefgelaufen",
  "crash.body":
    "ADGitter ist auf einen unerwarteten Fehler gestoßen. Dein Repository ist sicher auf der Festplatte.",
  "crash.reported": "Ein Diagnosebericht wurde gesendet.",
  "crash.reload": "Neu laden",
  "crash.dismiss": "Verwerfen",
  "user.language": "Sprache",
  "user.upgrade": "Upgrade",
  "user.logout": "Abmelden",
  "user.replayTutorial": "Tour erneut ansehen",
  "user.signIn": "Anmelden",
  "user.signingIn": "Im Browser fortfahren…",
  "user.signedOut": "Nicht angemeldet",
  "user.signInUnavailable": "Anmeldung nicht konfiguriert",
  "user.planCurrent": "Aktueller Tarif: {plan}",
  "user.manageSubscription": "Abo verwalten",
  "user.manageSubscriptionTitle":
    "Höchster Tarif — kündigen, Zahlungsmethode ändern oder Rechnungen ansehen",
  "portal.noSubscription": "Für dieses Konto wurde kein Abo gefunden.",
  "welcome.greeting": "Willkommen",
  "welcome.greetingName": "Willkommen {name}",
  "welcome.newOpen": "Neu / Öffnen",
  "welcome.removeRecent": "Aus zuletzt verwendeten entfernen",
  "tutorialUi.dialogLabel": "Interaktives Tutorial",
  "tutorialUi.progressLabel": "Schritt {index} von {total}",
  "tutorialUi.back": "Zurück",
  "tutorialUi.next": "Weiter",
  "tutorialUi.continue": "Fortfahren",
  "tutorialUi.retry": "Erneut versuchen",
  "tutorialUi.working": "Wird bearbeitet…",
  "tutorialUi.blockedHint":
    "Im Moment ist nur der hervorgehobene Bereich aktiv. Folge den Anweisungen auf dieser Karte.",
  "tutorialUi.exit": "Tutorial beenden",
  "tutorialUi.exitConfirmTitle": "Tutorial beenden?",
  "tutorialUi.exitConfirmBody":
    "Das Demo-Repository wird entfernt. Du kannst das Tutorial jederzeit über das Kontomenü erneut abspielen.",
  "tutorialUi.exitKeep": "Weitermachen",
  "tutorialUi.exitConfirm": "Beenden",
  "welcomeTour.title": "Willkommen bei ADGitter",
  "welcomeTour.intro":
    "Ein Git-Client, den du mit Gesten bedienst. Das kannst du damit tun:",
  "welcomeTour.graph.title": "Ein Graph zum Anfassen",
  "welcomeTour.graph.body":
    "Dein gesamter Verlauf als übersichtliche Karte, Spur für Spur. Klicken, per Rahmen markieren und ziehen – direkt im Graphen.",
  "welcomeTour.drag.title": "Zusammenführen, Rebase und Cherry-Pick per Ziehen",
  "welcomeTour.drag.body":
    "Ziehe einen Branch oder Commit auf einen anderen, und ADGitter stellt dir nur die eine Frage, auf die es ankommt.",
  "welcomeTour.undo.title": "Rückgängig mit einem Klick",
  "welcomeTour.undo.body":
    "Du hast es dir bei einem Zusammenführen, Rebase oder Reset anders überlegt? Mach es rückgängig und arbeite einfach weiter.",
  "welcomeTour.surgery.title": "Eingriffe in den Verlauf",
  "welcomeTour.surgery.body":
    "Entferne eine Datei, die nie hätte committet werden dürfen, füge eine vergessene hinzu oder korrigiere eine alte Commit-Nachricht.",
  "welcomeTour.logAnytime.title": "Log Anytime als Zeitmaschine",
  "welcomeTour.logAnytime.body":
    "Erstellt im Hintergrund Snapshots deiner Arbeit, sodass du zu jedem beliebigen Zeitpunkt zurückspulen kannst.",
  "welcomeTour.themes.title": "Themen",
  "welcomeTour.themes.body":
    "Gib dem Graphen deine eigene Note mit Farben und Stilen aus dem Theme-Store.",
  "welcomeTour.issues.title": "Integrierter Issue-Tracker",
  "welcomeTour.issues.body":
    "Verbinde Jira, Asana, GitLab oder GitHub, erstelle einen Branch aus einem Issue und aktualisiere es während der Arbeit.",
  "welcomeTour.next": "Weiter",
  "welcomeTour.back": "Zurück",
  "welcomeTour.pageLabel": "Seite {page} von {total}",
  "welcomeTour.choiceTitle": "Wie möchtest du starten?",
  "welcomeTour.startTitle": "Interaktives Tutorial starten",
  "welcomeTour.startBody":
    "Übe jede Geste an einem Wegwerf-Demo-Repository. Deine eigenen Projekte bleiben unberührt.",
  "welcomeTour.directTitle": "ADGitter direkt verwenden",
  "welcomeTour.directBody":
    "Überspringe das Tutorial. Du kannst es jederzeit über das Kontomenü erneut abspielen.",
  "firstUse.title": "Erste Schritte",
  "firstUse.pageLabel": "Seite {page} von {total}",
  "firstUse.next": "Weiter",
  "firstUse.back": "Zurück",
  "firstUse.close": "Schließen",
  "firstUse.repo.title": "Mit einem Repository starten",
  "firstUse.repo.intro":
    "ADGitter arbeitet mit einem Git-Repository in einem Ordner auf deinem Computer. Beide Wege beginnen auf dem Willkommensbildschirm.",
  "firstUse.repo.createTitle": "Ein leeres Repository erstellen",
  "firstUse.repo.createBody":
    "Klicke auf Neu / Öffnen, wähle einen Ordner, der noch kein Git-Projekt ist, und bestätige mit Erstellen. ADGitter führt git init für dich aus.",
  "firstUse.repo.openTitle": "Ein bestehendes Repository öffnen",
  "firstUse.repo.openBody":
    "Klicke auf Neu / Öffnen und wähle einen Ordner, der bereits ein Git-Projekt enthält, oder klicke auf den Avatar eines zuletzt verwendeten Projekts, um direkt dorthin zurückzukehren.",
  "firstUse.remote.title": "Ein Remote verbinden",
  "firstUse.remote.intro":
    "Ein Remote-Repository bei GitHub, GitLab, Bitbucket oder Azure DevOps ist der Ort, an dem du deine Commits sicherst und teilst.",
  "firstUse.remote.cloneTitle": "Mit einem Remote starten",
  "firstUse.remote.cloneBody":
    "Wähle unter Neu / Öffnen „Ein Remote-Repository klonen“, füge die Git-URL ein, wähle einen Speicherort und füge ein Zugriffstoken hinzu, falls das Repository privat ist.",
  "firstUse.remote.settingsTitle":
    "Ein Remote zu einem lokalen Repository hinzufügen",
  "firstUse.remote.settingsBody":
    "Erstelle zuerst bei deinem Anbieter ein leeres Repository. Öffne dann Einstellungen → Allgemein → Remote & Authentifizierung und gib die HTTPS-URL und dein Zugriffstoken ein.",
  "firstUse.remote.sshHint":
    "Lieber SSH? Lass die Remote-URL leer, dann verbindet sich ADGitter mit deinem SSH-Schlüssel.",
  "firstUse.tokens.title": "Persönliche Zugriffstoken",
  "firstUse.tokens.intro":
    "Ein persönliches Zugriffstoken (PAT) ist ein passwortähnlicher Schlüssel, mit dem ADGitter für dich pushen, pullen oder Issues lesen kann – ohne dein echtes Passwort. Erstelle es auf der Website des Anbieters, kopiere es sofort und füge es in ADGitter ein.",
  "firstUse.tokens.where":
    "Git-Token gehören unter Einstellungen → Allgemein → Zugriffstoken. Issue-Tracker-Token gehören unter Einstellungen → Issue-Panel.",
  "firstUse.tokens.safety":
    "Behandle ein Token wie ein Passwort: Gib ihm nur die Rechte, die es braucht, setze ein Ablaufdatum und teile oder committe es niemals.",
  "firstUse.tokens.tabGit": "Git-Anbieter",
  "firstUse.tokens.tabIssues": "Issue-Tracker",
  "firstUse.tokens.openPage": "Token-Seite öffnen",
  "firstUse.tokens.scopes": "Erforderlicher Zugriff",
  "firstUse.tokens.steps": "So erstellst du es",
  "firstUse.git.github.scopes":
    "Classic Token: der Scope repo. Fine-grained Token: Repository permissions → Contents: Read and write.",
  "firstUse.git.github.steps":
    "Öffne Settings → Developer settings → Personal access tokens.\nWähle Generate new token.\nLege den obigen Zugriff fest, erzeuge das Token und kopiere es. GitHub zeigt es nur einmal an.",
  "firstUse.git.gitlab.scopes":
    "Die Scopes read_repository und write_repository (oder api).",
  "firstUse.git.gitlab.steps":
    "Öffne User settings → Access tokens und wähle Add new token.\nVergib einen Namen, setze ein Ablaufdatum und aktiviere die obigen Scopes.\nErstelle das Token und kopiere es.",
  "firstUse.git.bitbucket.scopes":
    "Ein Repository Access Token mit Repositories: Write (Read ist enthalten). App-Passwörter funktionieren nicht mehr.",
  "firstUse.git.bitbucket.steps":
    "Öffne dein Repository und dann Repository settings → Security → Access tokens.\nWähle Create Repository Access Token und gib ihm einen Namen.\nAktiviere Repositories: Write (Read ist enthalten), erstelle es, kopiere das Token und verwende es in ADGitter als Zugriffstoken.",
  "firstUse.git.azure.scopes": "Code: Read & write.",
  "firstUse.git.azure.steps":
    "Öffne User settings → Personal access tokens und wähle New Token.\nWähle deine Organisation und ein Ablaufdatum, dann Custom defined scopes.\nAktiviere Code: Read & write, erstelle das Token und kopiere es.",
  "firstUse.issue.jira.scopes":
    "Ein Atlassian-API-Token (nichts zum Ankreuzen). Dein Konto braucht die Berechtigung, Issues im Projekt zu bearbeiten. Verwende es zusammen mit deiner Atlassian-E-Mail-Adresse.",
  "firstUse.issue.jira.steps":
    "Öffne die Seite Atlassian API tokens und wähle Create API token.\nVergib eine Bezeichnung und ein Ablaufdatum.\nErstelle es und kopiere das Token.",
  "firstUse.issue.asana.scopes":
    "Ein persönliches Zugriffstoken mit denselben Rechten wie dein Asana-Konto (nichts zum Ankreuzen).",
  "firstUse.issue.asana.steps":
    "Öffne My apps in der Asana-Entwicklerkonsole.\nWähle Create new token und vergib einen Namen.\nKopiere das Token.",
  "firstUse.issue.gitlab.scopes": "Der Scope api.",
  "firstUse.issue.gitlab.steps":
    "Öffne User settings → Access tokens und wähle Add new token.\nVergib einen Namen, setze ein Ablaufdatum und aktiviere api.\nErstelle das Token und kopiere es.",
  "firstUse.issue.github.scopes":
    "Fine-grained Token: Repository permissions → Issues: Read and write. Ein Classic Token braucht stattdessen den Scope repo.",
  "firstUse.issue.github.steps":
    "Öffne Settings → Developer settings → Fine-grained tokens und wähle Generate new token.\nWähle die Repositories und setze Issues: Read and write.\nErzeuge es und kopiere das Token.",
  "firstUse.done.title": "Alles bereit",
  "firstUse.done.body":
    "Öffne oder erstelle ein Repository, um loszulegen. Du kannst das Tutorial jederzeit über das Kontomenü erneut abspielen.",
  "window.lockedUpsell": "Mehrere Fenster sind eine kostenpflichtige Funktion.",
  "toolbar.branches": "Branches & Tags",
  "toolbar.files": "Geänderte Dateien",
  "toolbar.push": "Push",
  "toolbar.pushOptions": "Weitere Push-Optionen",
  "toolbar.forcePush": "Force Push",
  "toolbar.pull": "Pull",
  "toolbar.undo": "Rückgängig",
  "toolbar.undoBlockedExternal":
    "Rückgängig ist nicht verfügbar: Dieses Repository wurde von einem anderen Git-Client geändert. Ändere hier etwas, um es erneut zu verwenden.",
  "toolbar.logAnytime": "Log Anytime",
  "status.ahead": "Voraus",
  "status.behind": "Zurück",
  "status.signedOut": "Nicht angemeldet",
  "status.configUnreadable": "Repo-Einstellungen nicht lesbar",
  "status.configUnreadableHint":
    "adgitter.config.json konnte nicht gelesen werden, daher verwendet dieses Repository die Standardeinstellungen. Die Originaldatei wurde nach {file} kopiert — nichts wurde überschrieben.",
  "status.configUnsavableHint":
    "adgitter.config.json konnte weder gelesen noch beiseitekopiert werden. Für dieses Repository werden KEINE Einstellungsänderungen gespeichert, bis du die Datei reparierst oder verschiebst — überschrieben wird nichts.",
  "time.today": "Heute",
  "time.yesterday": "Gestern",
  "empty.openRepo": "Repository öffnen",
  "empty.openHint": "Wähle ein lokales Git-Projekt zur Visualisierung.",
  "empty.firstBranch": "Erstelle deinen ersten Branch",
  "openCreate.prompt":
    "Bitte wähle einen Ort, um ein bestehendes Git-Projekt zu öffnen oder ein neues zu erstellen",
  "openCreate.targetLocation": "Zielort",
  "openCreate.cloneLink": "Ein Remote-Repository klonen →",
  "clone.projectLabel": "Projektbezeichnung",
  "clone.gitUrl": "Git-URL",
  "clone.location": "Ort",
  "clone.pat": "Persönliches Zugriffstoken (PAT)",
  "clone.patHint":
    "Optional: Private HTTPS-Repositories benötigen ein Token (GitHub PAT / GitLab-Zugriffstoken / Bitbucket-Zugriffstoken). Für öffentliche Repositories oder ssh://-URLs leer lassen (es werden die SSH-Schlüssel des Systems verwendet).",
  "clone.cloning": "Wird geklont…",
  "confirm.openRepo":
    "Das ausgewählte Verzeichnis enthält ein bestehendes Repository. Öffnen?",
  "confirm.createRepo":
    "Das ausgewählte Verzeichnis enthält kein Git-Projekt. Hier eins erstellen?",
  "common.close": "Schließen",
  "files.title": "Änderungen",
  "files.conflicted": "Konflikt",
  "files.staged": "Bereitgestellt",
  "files.changed": "Geändert",
  "files.untracked": "Nicht verfolgt",
  "files.ignored": "Ignoriert",
  "files.loading": "Wird geladen…",
  "files.clean": "Arbeitsverzeichnis ist sauber.",
  "files.stage": "Bereitstellen",
  "files.unstage": "Aus Staging entfernen",
  "files.discard": "Änderungen verwerfen",
  "files.openFile": "Im Standardeditor öffnen",
  "commit.message": "Commit-Nachricht",
  "commit.usingAccountEmail":
    "Hier ist keine git user.email gesetzt — dieser Commit wird als {email} verfasst.",
  "commit.usingAccountEmailHow":
    "Setze git config user.email, um unter einer anderen Adresse zu committen.",
  "commit.title": "Neuer Commit",
  "commit.create": "Commit {n}",
  "commit.creating": "Wird committet…",
  "commit.commitStaged": "{count} vorgemerkte committen",
  "commit.nothingStaged": "Nichts vorgemerkt",
  "commitDetails.filter": "Filter",
  "commitDetails.loading": "Änderungen werden geladen…",
  "commitDetails.noChanges": "Keine Dateiänderungen.",
  "commitDetails.history": "Dateiverlauf",
  "commitDetails.historyEmpty": "Kein Verlauf für diese Datei.",
  "commitDetails.editMessage": "Commit-Nachricht bearbeiten",
  "commitDetails.save": "Speichern",
  "commitDetails.copyBranch": "Branch-Namen kopieren ({branch})",
  "commitDetails.copyHash": "Vollständigen Commit-Hash kopieren ({sha})",
  "commitDetails.copied": "Kopiert",
  "commitDetails.viewDiff": "Diff anzeigen",
  "commitDetails.purgeFile": "Datei aus Verlauf entfernen",
  "commitDetails.linkedIssue": "Verknüpftes Issue öffnen",
  "commitDetails.addFile": "Datei hinzufügen",
  "commitDetails.addFilePickerTitle":
    "Eine Datei aus dem Arbeitsverzeichnis hinzufügen",
  "commitDetails.addFileEmpty":
    "Keine geänderten Dateien im Arbeitsverzeichnis.",
  "diff.loading": "Diff wird geladen…",
  "diff.none": "Kein Diff.",
  "diff.noChanges": "Keine Änderungen.",
  "diff.binary": "Binärdatei — kein Text-Diff.",
  "branchEdit.name": "Branch-Name",
  "branchEdit.color": "Farbe",
  "branchEdit.upstream": "Upstream",
  "branchEdit.upstreamNone": "(keiner)",
  "branchesPanel.addTag": "Hier Tag hinzufügen",
  "branchesPanel.addTagPlaceholder": "Tag-Name",
  "branchesPanel.edit": "Bearbeiten",
  "branchesPanel.fork": "Hier abzweigen",
  "branchesPanel.forkPlaceholder": "Neuer Branch-Name",
  "branchesPanel.goToIssue": "Zum verknüpften Issue",
  "branchesPanel.noUpstream": "Kein Upstream konfiguriert",
  "confirmRewrite.note": "Dies kann anschließend rückgängig gemacht werden.",
  "confirmRewrite.messagePlaceholder": "Neue Commit-Nachricht",
  "confirmRewrite.chooseBranch": "Welcher Branch ist das Ziel?",
  "confirmRewrite.chooseSourceBranch": "Welcher Branch ist die Quelle?",
  "confirmRewrite.chooseResetTarget":
    "Auf welchen Branch oder Commit zurücksetzen?",
  "general.autoPull": "Auto-Pull",
  "general.off": "Aus",
  "general.warning": "Warnung",
  "general.beforeCreateBranch": "Vor Branch-Erstellung",
  "general.beforePush": "Vor Push",
  "general.beforeCommit": "Vor Commit",
  "general.notify": "Benachrichtigen",
  "general.always": "Immer",
  "general.autoPullSeconds": "Reaktionszeit",
  "general.seconds": "Sekunden",
  "autoPull.title": "{before}: vom Remote pullen?",
  "autoPull.body":
    "Pullen bringt diesen Branch auf den aktuellen Stand, bevor die Operation läuft. „Jetzt nicht“ führt sie ohne Pull aus; „Abbrechen“ verwirft sie.",
  "autoPull.skipped":
    "„Jetzt nicht“ gedrückt — die Operation läuft ohne Pull weiter.",
  "autoPull.cancelled":
    "„Abbrechen“ gedrückt — die Operation wurde abgebrochen.",
  "autoPull.failed":
    "{before}: der Pull ist fehlgeschlagen, daher wurde nichts ausgeführt. {reason}",
  "autoPull.conflicted":
    "{before}: der Pull ist an Konflikten gestoppt — löse sie zuerst auf; nichts wurde ausgeführt.",
  "autoPull.pending": "Eine Auto-Pull-Abfrage wartet noch auf eine Antwort.",
  "general.unstaged": "Nicht bereitgestellte Dateien",
  "general.undoRedo": "Rückgängig / Wiederholen",
  "general.times": "Mal",
  "general.git": "Git",
  "general.dryRun": "Testlauf",
  "general.gitIdentity": "Git-Identität",
  "general.gitName": "Git-Name",
  "general.gitEmail": "Git-E-Mail",
  "general.useProjectEmail": "Projektidentität verwenden",
  "general.gitEmailHintGlobal":
    "Git-Identität gilt für alle Repositories (~/.gitconfig)",
  "general.gitEmailHintProject":
    "Nur dieses Repository (.git/config); überschreibt die globale Git-Identität",
  "general.useAccountIdentity": "Identität des angemeldeten Kontos verwenden",
  "general.accountIdentityHint":
    "Nur dieses Repository (.git/config); überschreibt sie mit der Identität des Kontos",
  "general.accountIdentityNoAccount":
    "Anmelden, um die Identität des Kontos zu verwenden",
  "general.identityFallbackHint":
    "Da kein Name / keine E-Mail gesetzt ist, wird der Standardwert verwendet",
  "general.hideGhosts": "Unreferenzierte Commits ausblenden",
  "general.hideGhostsHint":
    "Commits, die nur durch Rückgängig-Sicherungen nach einer Verlaufsumschreibung erhalten bleiben",
  "general.remoteHeading": "Remote & Authentifizierung",
  "general.remoteUrl": "Remote-URL",
  "general.accessToken": "Zugriffstoken",
  "general.authHint":
    "Verwendet ein HTTPS-Zugriffstoken (PAT) für Fetch / Pull / Push. Passwort-Authentifizierung wird nicht unterstützt.",
  "general.openTokenPage": "Wo erhalte ich ein Zugriffstoken?",
  "general.remoteNoRepo":
    "Öffne ein Repository, um dessen Remote-URL und Zugriffstoken zu konfigurieren.",
  "general.remoteOverrideHint":
    "Der .git-Remote dieses Repositories ist {url}. Gib hier eine URL ein, um stattdessen diese zu verwenden (mit deinem Token); lass es leer, um den .git-Remote per SSH-Schlüssel zu verwenden.",
  "panel.resize": "Zum Ändern der Panelbreite ziehen",
  "remote.notHttps":
    "Ein Zugriffstoken ist gesetzt, aber dieser Remote ist keine HTTPS-URL —— ein Token funktioniert nur über HTTPS (und würde über einfaches http offengelegt). Push, Pull und das Erstellen von Merge Requests oder Issues sind deaktiviert. Entferne das Token, um über SSH zu verbinden, oder wechsle den Remote zu einer HTTPS-URL.",
  "personalize.graphTheme": "Graph-Thema",
  "personalize.textSize": "Textgröße",
  "personalize.small": "Klein",
  "personalize.medium": "Mittel",
  "personalize.large": "Groß",
  "personalize.preview": "Vorschau",
  "personalize.apply": "Anwenden",
  "personalize.inUse": "In Verwendung",
  "personalize.font": "Schriftart",
  "personalize.fontSystem": "System",
  "personalize.fontSans": "Serifenlos",
  "personalize.fontMono": "Monospace",
  "personalize.buy": "Kaufen",
  "personalize.owned": "Erworben",
  "personalize.author": "Autor",
  "personalize.refreshPurchase": "Kauf aktualisieren",
  "graphTheme.default.description":
    "Der eingebaute Metro-Graph — klare Schienen und volle Knoten.",
  "graphTheme.midnight.description":
    "Eine dunkelblaue Fläche mit sanften, hellen Schienen — angenehm für die Augen bei Nacht.",
  "graphTheme.synthwave.description":
    "Retro-futuristischer Neon-Sonnenuntergang: leuchtende, branch-getönte Knoten, spurgefärbte Glow-Schienen, eine gestreifte Sonne und CRT-Scanlines.",
  "graphTheme.blueprint.description":
    "Technische-Zeichnung-Look: blaupausenblauer Hintergrund, schraffierte Schienen und Zirkel-Knoten.",
  "graphTheme.hero.description":
    "Pixel-Art-RPG-Welt: ein Held mit Schwert und Schild, ein Dorf und steinerne Straßenschienen, die sich über die Karte schlängeln.",
  "shortcut.pressKeys": "Tasten drücken…",
  "shortcut.conflict":
    "Einige Tastenkombinationen stehen im Konflikt — löse sie vor dem Speichern auf.",
  "shortcut.restoreDefaults": "Standardwerte wiederherstellen",
  "shortcut.action.switchHandTool": "Handwerkzeug umschalten",
  "shortcut.action.pull": "Pull",
  "shortcut.action.push": "Push",
  "shortcut.action.newBranch": "Neuer Branch",
  "shortcut.action.newTag": "Neuer Tag",
  "shortcut.action.showBranchPanel": "Branch-Panel anzeigen",
  "shortcut.action.showTagPanel": "Tag-Panel anzeigen",
  "shortcut.action.showSettingPanel": "Einstellungs-Panel anzeigen",
  "menu.cherryPickOnto": "Cherry-Pick auf {branch}",
  "menu.revert": "Diesen Commit zurücksetzen",
  "menu.reword": "Nachricht umformulieren…",
  "menu.squash": "Zu einem Commit zusammenfassen…",
  "menu.resetMixed": "Branch hierher zurücksetzen (mixed)",
  "menu.resetHard": "Branch hierher zurücksetzen (hard)",
  "menu.drop": "Diesen Commit verwerfen",
  "menu.checkout": "Auschecken",
  "menu.mergeIntoParent": "{branch} zusammenführen in…",
  "menu.rebaseOntoParent": "Rebase auf {branch}…",
  "menu.branchCurrent": "{branch} (aktuell)",
  "menu.checkoutTag": "Tag {tag}",
  "menu.checkoutDetached": "Dieser Commit ({short}, detached)",
  "menu.createBranchHere": "Branch hier erstellen…",
  "menu.createBranchFrom": "Branch von {branch} erstellen…",
  "menu.branchProps": "Eigenschaften…",
  "menu.checkoutRemote": "Auschecken…",
  "createBranch.title": "Branch erstellen",
  "createBranch.from": "Von",
  "createBranch.name": "Branch-Name",
  "createBranch.placeholder": "feature/mein-branch",
  "remoteAdopt.title": "Diesen Remote-Branch verfolgen?",
  "remoteAdopt.body":
    "{branch} existiert lokal schon, verfolgt aber nichts. Upstream auf {remote} setzen und auschecken?",
  "remoteAdopt.confirm": "Upstream setzen & auschecken",
  "remotePull.title": "Zum Abgleichen pullen?",
  "remotePull.body":
    "{branch} liegt {behind} Commit(s) hinter {remote}. Jetzt pullen, um vorzuspulen?",
  "remotePull.confirm": "Pullen",
  "remotePull.skip": "Jetzt nicht",
  "notice.remoteInSync":
    "{branch} ausgecheckt — bereits auf dem Stand von {remote}.",
  "notice.remoteLocalAhead":
    "{branch} ausgecheckt — {ahead} Commit(s) vor {remote}; es gibt nichts zu pullen.",
  "notice.remoteDiverged":
    "{branch} ausgecheckt — {branch} und {remote} sind auseinandergelaufen ({ahead} vor, {behind} zurück); ein Pull würde mergen, das bleibt dir überlassen.",
  "notice.remoteUpstreamSet":
    "{branch} verfolgt jetzt {remote} und ist ausgecheckt.",
  "notice.remotePullSkipped":
    "Nicht gepullt — {branch} liegt weiterhin {behind} Commit(s) hinter {remote}.",
  "remoteCheckout.title": "Remote-Branch auschecken",
  "remoteCheckout.body":
    "{name} ist ein Remote-Branch. Einen lokalen Branch erstellen, um daran zu arbeiten?",
  "remoteCheckout.localName": "Lokaler Branch-Name",
  "remoteCheckout.create": "Erstellen & auschecken",
  "remoteCheckout.detached": "Detached auschecken",
  "checkoutChoice.title": "Branch zum Auschecken wählen",
  "checkoutChoice.body":
    "Dieser Commit hat mehrere lokale Branches. Welchen möchtest du auschecken?",
  "op.revert.title": "Commit zurücksetzen",
  "op.revert.body":
    "Erstellt einen neuen Commit, der „{subject}“ rückgängig macht.",
  "op.revert.confirm": "Zurücksetzen",
  "op.cherryPick.titleOne": "Commit auswählen (Cherry-Pick)",
  "op.cherryPick.titleMany": "Commits auswählen (Cherry-Pick)",
  "op.cherryPick.body": "{what} auf {branch} anwenden.",
  "op.cherryPick.whatOne": "„{subject}“",
  "op.cherryPick.whatMany": "{n} Commits",
  "op.cherryPick.confirm": "Cherry-Pick",
  "op.reset.title": "Zurücksetzen ({mode})",
  "op.reset.body": "{branch} zu {short} verschieben. {effect}",
  "op.reset.effectHard": "Änderungen im Arbeitsverzeichnis werden verworfen.",
  "op.reset.effectSoft":
    "Änderungen bleiben erhalten und weiterhin bereitgestellt.",
  "op.reset.effectKeep": "Änderungen bleiben im Arbeitsverzeichnis erhalten.",
  "op.reset.confirm": "Zurücksetzen",
  "graph.resetTip.mixed":
    "Reset --mixed · Änderungen behalten, nicht bereitgestellt",
  "graph.resetTip.hard": "Reset --hard · alle Änderungen verwerfen",
  "graph.resetTip.soft": "Reset --soft · Änderungen bereitgestellt behalten",
  "graph.rebaseTip": "{branch} auf {short} rebasen",
  "graph.backToTop": "Nach oben",
  "graph.cherryPickTip":
    "{n} Commits per Cherry-Pick auf neuen Branch bei {short}",
  "op.drop.title": "Commit verwerfen",
  "op.drop.body":
    "Entfernt „{subject}“ und spielt die Folge-Commits ohne diesen erneut ab.",
  "op.drop.confirm": "Verwerfen",
  "op.reword.title": "Commit-Nachricht umformulieren",
  "op.reword.body":
    "Bearbeite die Nachricht dieses Commits. Folge-Commits werden darauf neu geschrieben.",
  "op.reword.confirm": "Nachricht speichern",
  "op.squash.title": "Commits zusammenfassen",
  "op.squash.body":
    "Fasst diese {n} Commits mit der unten stehenden Nachricht zu einem zusammen. Folge-Commits werden darauf neu geschrieben.",
  "op.squash.confirm": "Zusammenfassen",
  "op.purgeFile.title": "Datei aus Verlauf entfernen",
  "op.purgeFile.body":
    "Entfernt „{path}“ aus „{subject}“ — und aus jedem nachfolgenden Commit bis zur Branch-Spitze. Dies ist eine umfangreiche Änderung: Sie schreibt diesen Commit und alle seine Folge-Commits neu.",
  "op.purgeFile.confirm": "Datei entfernen",
  "op.addFile.title": "Datei zu Commit hinzufügen",
  "op.addFile.body":
    "Schreibt „{path}“ in „{subject}“ — und in jeden nachfolgenden Commit bis zur Branch-Spitze. Dies ist eine umfangreiche Änderung: Sie schreibt diesen Commit und alle seine Folge-Commits neu.",
  "op.addFile.confirm": "Datei hinzufügen",
  "op.merge.title": "Branch zusammenführen",
  "op.merge.body":
    "{source} in {branch} zusammenführen (wenn möglich Fast-Forward).",
  "op.merge.confirm": "Zusammenführen",
  "op.mergeBranches.body":
    "{source} in {target} zusammenführen (wenn möglich Fast-Forward).",
  "op.mergeBranches.bodyCheckout":
    "{target} auschecken und dann {source} hineinführen (wenn möglich Fast-Forward).",
  "op.rebase.title": "Branch rebasen",
  "op.rebase.body":
    "Spielt die Commits von {branch} auf {onto} erneut ab. Dies schreibt diese Commits neu.",
  "op.rebase.confirm": "Rebase",
  "op.rebaseBranch.body":
    "Spielt die Commits von {branch} auf {onto} erneut ab. Dies schreibt diese Commits neu.",
  "op.rebaseBranch.bodyCheckout":
    "Spielt die Commits von {branch} auf {onto} erneut ab, wechselt dann zurück zu deinem aktuellen Branch und stellt dein Arbeitsverzeichnis exakt so wieder her, wie es jetzt ist. Dies schreibt diese Commits neu.",
  "op.cherryPickNewBranch.title": "Cherry-Pick auf neuen Branch",
  "op.cherryPickNewBranch.bodyOne":
    "Erstellt einen neuen Branch bei {short} und wendet 1 Commit per Cherry-Pick darauf an.",
  "op.cherryPickNewBranch.bodyMany":
    "Erstellt einen neuen Branch bei {short} und wendet {n} Commits per Cherry-Pick darauf an.",
  "op.cherryPickNewBranch.confirm": "Cherry-Pick",
  "op.removeBranch.title": "Branch entfernen",
  "op.removeBranch.body":
    "Löscht die Branch-Bezeichnung „{name}“. Commits, die nur von ihm aus erreichbar sind, werden unerreichbar (bleiben bis zur Garbage Collection erhalten).",
  "op.removeBranch.confirm": "Branch entfernen",
  "op.forcePush.title": "Force Push",
  "op.forcePush.body":
    "Dies überschreibt den Remote-Branch mit deinem lokalen Verlauf. Commits, die andere gepusht haben und die nicht in deinem lokalen Verlauf enthalten sind, können dauerhaft verloren gehen.",
  "op.forcePush.confirm": "Force Push",
  "resolve.banner":
    "Konflikt bei der Anwendung von {short} ({op} auf {branch}) — löse jede konfliktbehaftete Datei auf, stelle sie bereit und fahre dann fort.",
  "resolve.continue": "Fortfahren",
  "resolve.abort": "Abbrechen",
  "resolve.stageAllFirst":
    "Stelle jede konfliktbehaftete Datei bereit, um fortzufahren.",
  "resolve.abortConfirm.title": "Die pausierte Operation abbrechen?",
  "resolve.abortConfirm.body":
    "Alles wird auf den Zustand vor Beginn der Operation zurückgesetzt. Alle von dir vorgenommenen Konfliktlösungen werden verworfen.",
  "resolve.abortConfirm.confirm": "Abbrechen",
  "branch.head": "HEAD",
  "notice.undid": "{op} rückgängig gemacht",
  "notice.nothingToUndo": "Nichts rückgängig zu machen",
  "notice.pulled": "Vom Upstream gepullt",
  "notice.pushed": "Zum Upstream gepusht",
  "notice.forcePushed": "Zum Upstream force-gepusht",
  "notice.dryRunPush": "Testlauf — Push übersprungen",
  "notice.dryRunPull": "Testlauf — Pull übersprungen",
  "notice.commitInFiles":
    "Stelle deine Änderungen im Dateien-Panel bereit und committe sie.",
  "notice.reset": "Zurückgesetzt ({mode}) auf {short}.",
  "notice.purged": "{path} aus dem Verlauf entfernt.",
  "notice.addedFile": "{path} zum Verlauf hinzugefügt.",
  "notice.squashed": "{n} Commits zu einem zusammengefasst.",
  "notice.resolved": "Konflikte gelöst — {op} abgeschlossen.",
  "notice.opAborted":
    "Operation abgebrochen — vorheriger Zustand wiederhergestellt.",
  "notice.remapSkipped":
    "Verlauf umgeschrieben, aber diese Branches konnten nicht automatisch neu gebasiert werden (ihre Änderungen stehen im Konflikt): {branches}",
  "notice.branchCreated": "Branch {name} erstellt.",
  "notice.detachedAt": "{short} ausgecheckt (detached HEAD).",
  "notice.openFailed":
    "{name} konnte nicht geöffnet werden. Aus zuletzt verwendeten entfernen?",
  "notice.remoteCheckedOut":
    "{branch} erstellt und ausgecheckt, verfolgt den Remote.",
  "notice.detachedCheckedOut": "{name} ausgecheckt (detached HEAD).",
  "settings.general": "Allgemein",
  "settings.shortcut": "Tastenkombination",
  "settings.issuePanel": "Issue-Panel",
  "settings.account": "Konto",
  "settings.personalize": "Personalisieren",
  "settings.themes": "Themen",
  "settings.plan": "Plan",
  "settings.logAnytime": "Log Anytime",
  "settings.devices": "Geräte",
  "settings.scopeRepo": "In diesem Repository gespeichert",
  "settings.scopeGlobalFallback":
    "Kein Repository geöffnet — App-Standardwerte werden bearbeitet",
  "themeStore.lede":
    "Kaufe ein Thema einmal — es gehört dir dauerhaft, auf jedem Plan.",
  "themeStore.refresh": "Käufe aktualisieren",
  "themeStore.apply": "Anwenden",
  "themeStore.applied": "Angewendet",
  "themeStore.buy": "Kaufen ${price}",
  "themeStore.notForSale": "Noch nicht käuflich",
  "themeStore.notForSale.hint":
    "Dieses Theme ist noch nicht käuflich. Bitte später erneut nachsehen.",
  "themeStore.downloading": "Wird heruntergeladen…",
  "themeStore.error.offline":
    "Dieses Thema konnte nicht heruntergeladen werden — prüfe deine Verbindung. Dein aktuelles Thema bleibt unverändert.",
  "themeStore.error.signIn":
    "Melde dich an, um dieses Thema herunterzuladen. Dein aktuelles Thema bleibt unverändert.",
  "themeStore.error.notOwned":
    "Dieses Thema gehört noch nicht zu deinen Käufen. Dein aktuelles Thema bleibt unverändert.",
  "themeStore.error.notFound":
    "Dieses Thema ist nicht mehr verfügbar. Dein aktuelles Thema bleibt unverändert.",
  "themeStore.error.rejected":
    "Dieses Thema hat die Sicherheitsprüfung nicht bestanden und wurde nicht installiert. Dein aktuelles Thema bleibt unverändert.",
  "checkout.signingIn": "Warten auf die Anmeldung…",
  "checkout.signInCancelled":
    "Anmeldung abgebrochen – es wurde nichts gekauft.",
  "checkout.signInTimedOut":
    "Zeitüberschreitung bei der Anmeldung – es wurde nichts gekauft.",
  "checkout.signInFailed":
    "Anmeldung konnte nicht abgeschlossen werden – es wurde nichts gekauft.",
  "checkout.signInUnavailable": "Anmeldung ist derzeit nicht verfügbar.",
  "checkout.unavailable": "Checkout ist derzeit nicht verfügbar.",
  "checkoutReturn.processing": "Kauf wird abgeschlossen…",
  "checkoutReturn.unlockedTheme":
    "Kauf abgeschlossen — dein neues Theme ist freigeschaltet und kann angewendet werden.",
  "checkoutReturn.unlocked":
    "Kauf abgeschlossen — dein Konto wurde aktualisiert.",
  "checkoutReturn.pending":
    "Die Zahlungsbestätigung ist noch nicht eingetroffen. Nichts ist verloren — dein Kauf wird freigeschaltet, sobald sie ankommt. Prüfe es in ein paar Minuten erneut oder öffne ADGitter neu.",
  "checkoutReturn.signInNeeded":
    "Melde dich an, um deinen Kauf freizuschalten.",
  "checkoutReturn.checkAgain": "Erneut prüfen",
  "account.signedOut":
    "Melde dich an, um dein Konto zu verwalten und kostenpflichtige Funktionen freizuschalten.",
  "account.signIn": "Anmelden",
  "account.signingIn": "Wird angemeldet…",
  "account.cancelSignIn": "Abbrechen",
  "account.signingInHint":
    "Schließe die Anmeldung im Browser ab. Danach kehrt die App von selbst zurück.",
  "account.signOut": "Abmelden",
  "account.signOutConfirm.title": "Auf diesem Gerät abmelden?",
  "account.signOutConfirm.body":
    "Das Abmelden entfernt die auf diesem Gerät gespeicherte Lizenz: bezahlte Funktionen und gekaufte Themes werden nicht mehr verfügbar sein. Beim erneuten Anmelden kommt alles zurück.",
  "account.signOutConfirm.bodyOffline":
    "Du scheinst offline zu sein. Die Anmeldung wird online geprüft, deshalb kommst du erst wieder in dieses Konto, wenn du eine Verbindung hast. Das Abmelden entfernt trotzdem die auf diesem Gerät gespeicherte Lizenz: bezahlte Funktionen und gekaufte Themes werden nicht mehr verfügbar sein. Beim erneuten Anmelden kommt alles zurück.",
  "account.signOutIncomplete":
    "Du bist abgemeldet, aber die auf diesem Gerät gespeicherte Lizenz konnte nicht entfernt werden. Bezahlte Funktionen bleiben möglicherweise entsperrt, bis du ADGitter neu startest.",
  "account.name": "Name",
  "account.email": "E-Mail",
  "account.username": "Benutzername",
  "account.manageHint": "Diese öffnen das Kontoportal in deinem Browser.",
  "account.emailCommitDefault":
    "Wird nur als Commit-Autor verwendet, wenn git keine eigene user.email hat; eine konfigurierte user.email gewinnt immer.",
  "account.manageAccount": "Konto verwalten",
  "account.password": "Passwort & Sicherheit",
  "account.mfa": "Zwei-Faktor-Authentifizierung",
  "account.mfaNotConfigured":
    "Die Zwei-Faktor-Authentifizierung ist für ADGitter noch nicht aktiviert — sie erscheint auf der Sicherheitsseite von Clerk erst, wenn ein Administrator sie einschaltet.",
  "account.organization": "Organisation",
  "account.payment": "Zahlungsmethoden",
  "plan.currentBadge": "Aktuell",
  "plan.upgrade": "Upgrade",
  "plan.refresh": "Berechtigung aktualisieren",
  "adGate.title": "Die kostenlose Version ist werbefinanziert",
  "adGate.body":
    "In der kostenlosen Version von ADGitter wird unten im Fenster eine Anzeige eingeblendet. Die Werbeeinnahmen ermöglichen es uns, die Software weiter zu pflegen und zu entwickeln. Wenn Sie keine Werbung sehen möchten, können Sie zu einem kostenpflichtigen Plan wechseln.",
  "adGate.data":
    "Die Anzeigen stammen von Carbon Ads; beim Einblenden erhält Carbon Ads Ihre IP-Adresse und Browserinformationen.",
  "adGate.privacy": "Datenschutzerklärung",
  "adGate.accept": "Werbung akzeptieren und kostenlos weiter nutzen",
  "adGate.buy": "Zu einem kostenpflichtigen Plan wechseln",
  "adGate.signIn": "Bereits gekauft? Anmelden",
  "adGate.decline": "Werbung nicht akzeptieren",
  "ad.label": "Werbung",
  "ad.fallback":
    "Diese Werbefläche finanziert die kostenlose Version von ADGitter. Mit einem kostenpflichtigen Plan entfällt sie.",
  "ad.remove": "Werbung entfernen",
  "crashConsent.label": "Fehlerberichte",
  "crashConsent.message":
    "Absturz- und Fehlerberichte senden, damit wir Probleme beheben können? Die Berichte gehen über Sentry, E-Mail-Adressen und Dateipfade werden entfernt, Ihr Code ist nie enthalten. Sie können das später unter Einstellungen → Datenschutz ändern.",
  "crashConsent.allow": "Erlauben",
  "crashConsent.deny": "Nein danke",
  "settings.privacy": "Datenschutz",
  "privacy.crashReports": "Absturz- und Fehlerberichte senden (Sentry)",
  "privacy.crashReportsHint":
    "E-Mail-Adressen und Dateipfade werden vorher entfernt; Code oder Diffs sind nie enthalten.",
  "privacy.ads": "Werbung in der kostenlosen Version (Carbon Ads)",
  "privacy.adsPaid":
    "Kostenpflichtige Pläne zeigen keine Werbung und laden keinen Werbecode.",
  "privacy.adsWithdrawPay":
    "Sie haben der Werbung zugestimmt. Wenn Sie widerrufen, müssen Sie erneut zustimmen oder zu einem kostenpflichtigen Plan wechseln, um die kostenlose Version weiter zu nutzen.",
  "privacy.adsWithdrawFree":
    "Sie haben der Werbung zugestimmt. Wenn Sie widerrufen, wird keine Werbung mehr angezeigt.",
  "privacy.adsNotGiven":
    "Sie haben der Werbung nicht zugestimmt, daher wird keine geladen.",
  "privacy.adsWithdraw": "Einwilligung widerrufen",
  "trial.offer": "{plan} {days} Tage kostenlos testen",
  "trial.note":
    "Keine Karte nötig, es wird nichts berechnet. Danach sind Sie automatisch wieder bei Free – kaufen Sie jederzeit, um weiterzumachen. Ein Test pro Computer und pro Konto.",
  "trial.start": "Kostenlosen Test starten",
  "trial.starting": "Wird gestartet…",
  "trial.active": "{plan}-Test – endet am {date}.",
  "trial.ended": "Ihr {plan}-Test ist am {date} abgelaufen.",
  "trial.used":
    "Dieser Computer oder dieses Konto hat den kostenlosen Test bereits genutzt.",
  "trial.failed":
    "Der Test lässt sich gerade nicht starten. Bitte versuchen Sie es später erneut.",
  "trial.badge": "Test",
  "trial.buy": "{plan} kaufen",
  "plan.feature": "Funktion",
  "plan.free": "Kostenlos",
  "plan.basic": "Basic",
  "plan.advance": "Advance",
  "plan.enterprise": "Enterprise",
  "plan.feat.noAd": "Anzeigen entfernen",
  "plan.feat.applyTheme": "Benutzerdefiniertes Thema anwenden",
  "plan.feat.logBackground":
    "Log Anytime Hintergrundausführung + periodische Komprimierung",
  "plan.feat.tickets": "Priorisierte Support-Tickets",
  "plan.feat.seats": "Team-Plätze",
  "plan.feat.devices": "Gleichzeitige Geräte",
  "plan.seatsAddOn": "{seats} (Zusatzplätze erhältlich)",
  "deviceSeat.limitTitle": "Gerätelimit für die Anmeldung überschritten",
  "deviceSeat.limitBody":
    "Mit OK wird das älteste Gerät abgemeldet und dieses Gerät angemeldet.",
  "devices.usage": "{used} von {max} Geräten",
  "devices.thisDevice": "Dieses Gerät",
  "devices.remove": "Entfernen",
  "devices.lastSeen": "Zuletzt gesehen {when}",
  "devices.neverSeen": "Nie gesehen",
  "devices.empty":
    "Noch keine Geräte. Melde dich an, um dieses Gerät zu synchronisieren.",
  "webhook.provider.slack": "Slack",
  "webhook.provider.jira": "Jira",
  "webhook.provider.github": "GitHub",
  "webhook.provider.gitlab": "GitLab",
  "webhook.scope.send_notification": "Benachrichtigung senden",
  "webhook.scope.commit": "Commit",
  "webhook.scope.leave_comment": "Kommentar hinterlassen",
  "webhook.scope.create_branch": "Branch erstellen",
  "webhook.scope.rename_branch": "Branch umbenennen",
  "webhook.scope.delete_branch": "Branch löschen",
  "issueProvider.description":
    "Verbinde ein externes Tracking-System mit diesem Repository. Dessen Issues öffnen sich im Issue-Panel, und Bearbeitungen werden zurücksynchronisiert.",
  "issueProvider.noRepo":
    "Öffne ein Repository, um einen Issue-Anbieter zu verbinden.",
  "issueProvider.providerLabel": "Anbieter",
  "issueProvider.deploymentLabel": "Bereitstellung",
  "issueProvider.deployment.cloud": "Cloud",
  "issueProvider.deployment.selfHosted": "Selbst gehostet",
  "issueProvider.hostUrlLabel": "Host-URL",
  "issueProvider.hostUrlPlaceholder": "https://…",
  "issueProvider.usernameLabel": "E-Mail",
  "issueProvider.usernamePlaceholder": "du@beispiel.com",
  "issueProvider.tokenLabel": "Zugriffstoken",
  "issueProvider.tokenPlaceholder": "Persönliches Zugriffstoken einfügen",
  "issueProvider.scopeHint.github":
    "Verwende ein fein abgestuftes Token mit der Berechtigung „Issues: Read and write“.",
  "issueProvider.scopeHint.gitlab":
    "Verwende ein Token mit dem Bereich „api“ (oder „read_api“ für nur Lesen).",
  "issueProvider.scopeHint.jira":
    "Das Konto des Tokens benötigt die Berechtigung „Edit issues“ im Zielprojekt.",
  "issueProvider.scopeHint.asana":
    "Ein persönliches Zugriffstoken erbt die Berechtigungen deines Asana-Kontos.",
  "issueProvider.openTokenPage": "Wo bekomme ich ein Token?",
  "issueProvider.scopeLabel": "Bereich",
  "issueProvider.scopePlaceholder": "Repository / Projekt auswählen…",
  "issueProvider.loadingContainers": "Verfügbare Projekte werden geladen…",
  "issueProvider.connect": "Verbinden",
  "issueProvider.connecting": "Verbindung wird hergestellt…",
  "issueProvider.disconnect": "Trennen",
  "issueProvider.invalidToken":
    "Dieses Zugriffstoken hat die Validierung nicht bestanden.",
  "issueProvider.errHostRequired":
    "Für diesen Anbieter ist eine Host-URL erforderlich.",
  "issueProvider.errEmailRequired":
    "Für Jira Cloud ist eine E-Mail-Adresse erforderlich.",
  "issueProvider.errVerifyFailed":
    "Die Anmeldedaten konnten nicht überprüft werden.",
  "issueProvider.switchHint":
    "Das Verbinden eines Anbieters ersetzt den derzeit mit diesem Repository verbundenen Anbieter.",
  "issueProvider.boundTo": "Verbunden mit {provider}",
  "issueProvider.state.disconnected": "Getrennt",
  "issueProvider.state.connected": "Verbunden",
  "issueProvider.state.error": "Fehler",
  "issueProvider.provider.jira": "Jira",
  "issueProvider.provider.asana": "Asana",
  "issueProvider.provider.gitlab": "GitLab",
  "issueProvider.provider.github": "GitHub",
  "issueProvider.credentialSaved": "Zugriffstoken gespeichert {masked}",
  "issueProvider.credentialSavedHint":
    "Im Schlüsselbund des Systems gespeichert und beim nächsten Start automatisch wiederverwendet.",
  "issueProvider.replaceToken": "Ersetzen",
  "issueProvider.cancelReplace": "Gespeichertes Token behalten",
  "issueProvider.reconnecting":
    "Verbindung wird mit dem gespeicherten Token wiederhergestellt…",
  "issueProvider.errCredentialRejected":
    "Der Anbieter hat das gespeicherte Zugriffstoken abgelehnt – es wurde vermutlich widerrufen oder ist abgelaufen. Wählen Sie „Ersetzen“ und fügen Sie ein neues ein.",
  "issueProvider.errReconnectOffline":
    "Der Anbieter war nicht erreichbar, daher wurde das gespeicherte Token nicht erneut geprüft. Es bleibt gespeichert; versuchen Sie es erneut, sobald Sie wieder online sind.",
  "issueProvider.errTokenNotSaved":
    "Verbunden, aber das Token konnte nicht in den Schlüsselbund des Systems geschrieben werden und ist beim nächsten Start nicht vorhanden.",
  "issueProvider.scopeFilterPlaceholder": "Zum Filtern tippen…",
  "issueProvider.scopeNoMatches": "Kein passendes Projekt",
  "error.REPO_NOT_FOUND": "Repository nicht gefunden",
  "error.INVALID_PATH": "Ungültiger Pfad",
  "error.GIT_ERROR": "Git-Fehler",
  "error.IO_ERROR": "Dateisystemfehler",
  "error.INTERNAL_ERROR": "Etwas ist schiefgelaufen",
  "error.FEATURE_LOCKED":
    "Diese Funktion erfordert einen kostenpflichtigen Plan",
  "error.LICENSE_DEVICE_MISMATCH":
    "Diese Lizenz ist auf einem anderen Gerät registriert — melde dich erneut an, um sie auf diesem zu nutzen",
  "error.LICENSE_EXPIRED":
    "Deine Lizenz ist abgelaufen — verlängere sie, um kostenpflichtige Funktionen weiter zu nutzen",
  "error.NOT_SIGNED_IN": "Zum Fortfahren anmelden",
  "error.NO_SUBSCRIPTION": "Kein Abo gefunden",
  "error.CONFLICT": "Konflikt",
  "error.REMOTE_UPSTREAM_MISMATCH":
    "Dieser lokale Branch verfolgt einen anderen Remote-Branch",
  "error.MERGE_COMMIT_IN_RANGE":
    "Umschreiben über einen Merge-Commit hinweg ist nicht möglich",
  "error.conflict":
    "{short} steht im Konflikt mit dem Ziel — löse ihn manuell oder mache die Operation rückgängig.",
  "toolbar.issues": "Issues",
  "issue.search": "Issues durchsuchen…",
  "issue.backToList": "Zurück zur Issue-Liste",
  "issue.overflow": "Weitere Aktionen",
  "issue.refresh": "Vom Anbieter aktualisieren",
  "issue.lockedUpsell": "Issue-Tracking ist eine Advance-Funktion.",
  "issue.boundBranch": "Verbundener Branch",
  "issue.linkedBranches": "Verknüpfte Branches",
  "issue.empty.title": "Issues",
  "issue.empty.pick": "Wähle ein Issue zum Öffnen.",
  "issue.empty.none": "Das verbundene Projekt hat noch keine Issues.",
  "issue.empty.projectsFailed": "Projekte konnten nicht geladen werden.",
  "issue.empty.retryProjects": "Erneut versuchen",
  "issue.empty.pickProject": "Wähle ein Projekt, um seine Issues anzuzeigen.",
  "issue.empty.noMatch": "Keine Issues entsprechen deiner Suche.",
  "issue.empty.unbound":
    "Mit diesem Repository ist kein Issue-Tracker verbunden. Verbinde einen unter [[Einstellungen → Issue-Panel]].",
  "issue.empty.credentialMissing":
    "Das Zugriffstoken für den Issue-Tracker dieses Repositorys fehlt. Gib es unter [[Einstellungen → Issue-Panel]] erneut ein.",
  "issue.empty.loadFailed":
    "Issues konnten nicht vom Tracker geladen werden. Prüfe deine Verbindung und danach das Token unter [[Einstellungen → Issue-Panel]].",
  "issue.hoursUnit": "Std",
  "issue.status.created": "Erstellt",
  "issue.status.in_progress": "In Bearbeitung",
  "issue.status.done": "Erledigt",
  "issue.status.rejected": "Abgelehnt",
  "issue.field.project": "Projekt",
  "issue.field.status": "Status",
  "issue.field.labels": "Labels",
  "issue.field.assignee": "Zugewiesen an",
  "issue.field.due": "Fällig",
  "issue.field.milestone": "Meilenstein",
  "issue.field.spend": "Aufwand",
  "issue.field.cost": "Kosten",
  "issue.dueStart": "Start",
  "issue.dueEnd": "Ende",
  "issue.dueInvalid": "Das Startdatum muss vor oder am Enddatum liegen.",
  "issue.noAssignee": "Nicht zugewiesen",
  "issue.noMilestone": "Kein Meilenstein",
  "issue.noProject": "Kein Projekt",
  "issue.addLabel": "Label hinzufügen",
  "issue.spendLockedHint": "Bearbeitbar während der Bearbeitung",
  "issue.field.unsupportedHint":
    "Von diesem Tracker nicht unterstützt: {reason}",
  "issue.field.caveatHint": "Hinweis: {reason}",
  "issue.field.caveatDestructive": "Warnung — dies löscht Daten: {reason}",
  "issue.error.saveFailed":
    "Änderung konnte nicht gespeichert werden und wurde rückgängig gemacht: {reason}",
  "issue.error.refreshFailed":
    "Dieses Issue konnte nicht aktualisiert werden: {reason}",
  "issue.error.actionFailed":
    "Diese Aktion wurde nicht abgeschlossen: {reason}",
  "issue.action.new": "Neu…",
  "issue.action.reject": "Ablehnen",
  "issue.action.start": "Starten",
  "issue.action.startNewBranch": "Neuer Branch & Los",
  "issue.action.startJustGo": "Einfach loslegen",
  "issue.action.withdraw": "Zurückziehen",
  "issue.action.done": "Erledigt",
  "issue.action.doneUpdateSpent": "Aufwand aktualisieren & schließen",
  "issue.action.doneJustClose": "Einfach schließen",
  "issue.action.reopen": "Wieder öffnen",
  "issue.rejectedReason": "Abgelehnt: {reason}",
  "issue.comments.title": "Kommentare",
  "issue.comments.empty": "Noch keine Kommentare.",
  "issue.comments.placeholder": "Kommentar schreiben…",
  "issue.comments.send": "Senden",
  "issue.composer.title": "Neuer Branch & Los",
  "issue.composer.type": "Typ",
  "issue.composer.desc": "Kurzbeschreibung",
  "issue.composer.preview": "Branch-Name",
  "issue.composer.confirm": "Erstellen & auschecken",
  "issue.composer.invalid":
    "Gib eine Beschreibung ein, um einen gültigen Branch-Namen zu erstellen.",
  "issue.reject.title": "Issue ablehnen",
  "issue.reject.prompt":
    "Gib einen Grund für die Ablehnung dieses Issues an. Er wird beim Issue gespeichert.",
  "issue.reject.placeholder": "Grund…",
  "issue.reject.confirm": "Ablehnen",
  "issue.reject.required": "Ein Grund ist erforderlich.",
  "issue.new.title": "Neues Issue",
  "issue.new.titleField": "Titel",
  "issue.new.project": "Projekt",
  "issue.new.labels": "Labels (kommagetrennt)",
  "issue.new.confirm": "Erstellen",
  "integration.createMr": "Merge Request erstellen",
  "integration.createIssue": "Issue erstellen",
  "integration.noToken":
    "Füge ein GitHub- oder GitLab-Token in den Webhook-Einstellungen hinzu, um Merge Requests oder Issues zu öffnen.",
  "integration.composeMr": "Neuer Merge Request",
  "integration.composeIssue": "Neues Issue",
  "integration.titleField": "Titel",
  "integration.target": "Anbieter",
  "integration.targetBranch": "Ziel-Branch",
  "integration.creating": "Wird erstellt…",
  "integration.created": "Erstellt:",
  "integration.authError":
    "Authentifizierung fehlgeschlagen — überprüfe das Token in den Webhook-Einstellungen.",
  "integration.failed":
    "Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.",
  "common.browse": "Durchsuchen…",
  "branchEdit.title": "Branch bearbeiten",
  "search.scopeLabel": "Suchbereich",
  "graph.commitLabel": "Commit {sha} auswählen oder ziehen",
  "graph.commitHint":
    "Klicken zum Auswählen · auf einen Branch/Commit ziehen, um Cherry-Pick oder Neuanordnung durchzuführen",
  "graph.mergeHint":
    "Auf einen anderen Branch-Kopf ziehen, um zusammenzuführen",
  "graph.crownHint":
    "Klicken, um HEAD auszuwählen · auf einen Commit ziehen, um zurückzusetzen (Shift = harter Reset, Cmd/Ctrl = weicher Reset)",
  "graph.crownLabel": "HEAD auswählen oder verschieben",
  "graph.newCommit": "Neuer Commit",
  "menu.dismiss": "Menü schließen",
  "openCreate.title": "Öffnen oder erstellen",
  "openCreate.pathPlaceholder": "/path/to/project",
  "colorPicker.sv": "Sättigung und Helligkeit",
  "colorPicker.hue": "Farbton",
  "colorPicker.hex": "Hex",
  "clone.title": "Repository klonen",
  "clone.projectPlaceholder": "my-project",
  "clone.locationPlaceholder": "/path/to/clone/into",
  "diff.close": "Diff schließen",
  "diff.title": "Datei-Diff",
  "branchesPanel.filter": "filtern",
  "branchesPanel.localHint":
    "Klicken zum Auswählen, Doppelklick für Checkout von {name}",
  "branchesPanel.cannotDeleteCurrent":
    "Der aktuelle Branch kann nicht gelöscht werden",
  "branchesPanel.delete": "Löschen",
  "branchesPanel.remoteHint":
    "Doppelklick oder Rechtsklick für Checkout von {name}",
  "branchesPanel.remoteTag": "remote",
  "branchesPanel.deleteTag": "Tag löschen",
  "branchesPanel.newTagPlaceholder": "Neuer Tag (bei HEAD)",
  "branchesPanel.branchesHeading": "Branches",
  "branchesPanel.tagsHeading": "Tags",
  "themeStore.previewSubject": "Commit-Betreff",
  "tutorial.hint.info": "Klicke auf Weiter, um fortzufahren.",
  "tutorial.hint.busy": "Einen Moment, ADGitter richtet alles ein…",
  "tutorial.welcome.title": "Willkommen bei ADGitter",
  "tutorial.welcome.body":
    "ADGitter macht aus Git etwas, das du sehen und anfassen kannst: einen lebendigen Commit-Graphen, in dem du per Ziehen zusammenführst, rebast, Cherry-Picks durchführst und zurücksetzt. Diese kurze Tour nutzt ein Wegwerf-Übungs-Repository, deine echten Projekte bleiben also unberührt.",
  "tutorial.choose.title": "Tour starten?",
  "tutorial.choose.body":
    "Das geführte Tutorial zeigt dir jede Geste an einem Übungs-Repository und dauert etwa zehn Minuten. Du kannst es auch überspringen und ADGitter direkt verwenden. Über das Kontomenü kannst du es jederzeit erneut abspielen.",
  "tutorial.createDemo.title": "Ein Übungs-Repository erstellen",
  "tutorial.createDemo.body":
    "ADGitter erstellt ein kleines Demo-Repository mit eigenem lokalem Remote im Datenordner der App. Es berührt nie deine Repositories, dein Netzwerk oder dein Konto. Klicke auf Demo erstellen, um zu beginnen.",
  "tutorial.createDemo.hint": "Klicke auf Demo erstellen, um fortzufahren.",
  "tutorial.createDemo.primary": "Demo erstellen",
  "tutorial.tourGraph.title": "Den Graphen lesen",
  "tutorial.tourGraph.body":
    "Jede Zeile ist ein Commit, der neueste steht oben. Farbige Spuren zeigen, wie sich Branches teilen und wieder zusammenlaufen – der Verlauf liest sich wie ein U-Bahn-Plan. Dieses Übungs-Repository hat schon etwas Verlauf: einen Seiten-Branch, der in main zurückgeführt wurde, und ein getaggtes Release.",
  "tutorial.tourCommit.title": "Ein Commit",
  "tutorial.tourCommit.body":
    "Jeder Kreis ist ein Commit; dieser hier heißt „Write getting-started guide“. Laufen zwei Spuren in einem Commit zusammen, ist er ein Merge: direkt darüber siehst du „Merge branch 'docs/intro'“. Klicke auf einen Commit, um ihn auszuwählen und seine Details zu öffnen; später ziehst du von ihm aus, um zusammenzuführen, zu rebasen oder per Cherry-Pick zu übernehmen.",
  "tutorial.tourBranch.title": "Branch-Chips",
  "tutorial.tourBranch.body":
    "Der farbige Chip neben einem Commit ist ein Branch, der darauf zeigt. Klicke auf einen Chip, um den Branch auszuwählen, doppelklicke ihn, um ihn auszuchecken, oder ziehe ihn auf den Branch, auf dem du gerade bist, um ihn zusammenzuführen. Hier sind main und docs/intro zwei Branches; das kleine Tag v0.0.1 markiert ein Release auf dem Merge-Commit.",
  "tutorial.tourHead.title": "Die HEAD-Krone",
  "tutorial.tourHead.body":
    "Die Krone markiert HEAD, den Commit, an dem du arbeitest. Ziehst du sie auf einen älteren Commit, wird dein Branch auf diesen Commit zurückgesetzt – das probierst du gleich aus.",
  "tutorial.tourHandle.title": "Der Merge-Griff",
  "tutorial.tourHandle.body":
    "Fahre mit der Maus über die Spitze eines Branches, dann erscheint darüber ein kleiner runder Griff. Ziehe diesen Griff auf die Spitze eines anderen Branches, um die beiden zusammenzuführen.",
  "tutorial.firstCommit.title": "Deinen ersten Commit erstellen",
  "tutorial.firstCommit.body":
    "ADGitter hat in der Demo gerade ein paar neue Dateien angelegt. Öffne das Panel „Geänderte Dateien“, stelle sie bereit, gib eine Commit-Nachricht ein und committe. Dein Commit erscheint sofort im Graphen.",
  "tutorial.firstCommit.hint":
    "Öffne das Panel „Geänderte Dateien“, stelle die Dateien bereit und committe dann.",
  "tutorial.seedHistory.title": "Ein belebterer Verlauf",
  "tutorial.seedHistory.body":
    "Damit du an etwas Realistischem üben kannst, hat ADGitter weitere Commits, drei Branches (feature/login, feature/theme und experiment) und zwei Tags hinzugefügt. Sieh dich im Graphen um und klicke dann auf Weiter.",
  "tutorial.selectCommit.title": "Einen Commit auswählen",
  "tutorial.selectCommit.body":
    "Klicke auf einen beliebigen Commit, um ihn auszuwählen. Dabei öffnen sich auch seine Details, und so beginnen die meisten Gesten.",
  "tutorial.selectCommit.hint": "Klicke im Graphen auf einen Commit.",
  "tutorial.selectMany.title": "Mehrere Commits auswählen",
  "tutorial.selectMany.body":
    "Ziehe in einem leeren Bereich des Graphen einen Rahmen um zwei oder mehr Commits oder halte Strg (⌘ auf dem Mac) gedrückt und klicke weitere Commits an. Eine Mehrfachauswahl lässt sich als Gruppe verschieben oder kopieren.",
  "tutorial.selectMany.hint": "Markiere mindestens zwei Commits per Rahmen.",
  "tutorial.mergeDrag.title": "Per Ziehen zusammenführen",
  "tutorial.mergeDrag.body":
    "Fahre mit der Maus über die Spitze von feature/login, bis der runde Griff erscheint, und ziehe ihn dann auf main. Bestätige die Rückfrage, und ADGitter führt den Branch in main zusammen.",
  "tutorial.mergeDrag.hint":
    "Ziehe den runden Griff von feature/login auf main.",
  "tutorial.branchSelect.title": "Einen Branch auswählen",
  "tutorial.branchSelect.body":
    "Klicke auf den Chip feature/theme, um den gesamten Branch auszuwählen. Ein ausgewählter Branch wird als eine Einheit verschoben – genau das brauchst du als Nächstes zum Rebasen.",
  "tutorial.branchSelect.hint": "Klicke auf den Chip feature/theme.",
  "tutorial.rebase.title": "Einen Branch rebasen",
  "tutorial.rebase.body":
    "Ziehe den ausgewählten Branch feature/theme auf main, um seine Commits auf der neuesten Arbeit von main erneut anzuwenden. Dabei wird der Verlauf umgeschrieben, deshalb bittet ADGitter dich zuerst um Bestätigung.",
  "tutorial.rebase.hint": "Ziehe feature/theme auf den Chip main.",
  "tutorial.cherryPick.title": "Einen Commit per Cherry-Pick übernehmen",
  "tutorial.cherryPick.body":
    "Klicke im Branch experiment auf den Commit „Try faster render“, halte dann Alt (⌥ auf dem Mac) gedrückt und ziehe ihn auf den Chip main. Eine Kopie genau dieses Commits landet auf main.",
  "tutorial.cherryPick.hint":
    "Ziehe „Try faster render“ bei gedrückter Alt-Taste auf den Chip main.",
  "tutorial.undo.title": "Den letzten Vorgang rückgängig machen",
  "tutorial.undo.body":
    "Doch anders überlegt? Klicke in der Symbolleiste auf Rückgängig, um den letzten Vorgang zurückzunehmen – hier den Cherry-Pick. Es gibt kein Wiederholen, also geh vorsichtig vor.",
  "tutorial.undo.hint":
    "Klicke in der Symbolleiste auf die Schaltfläche Rückgängig.",
  "tutorial.reset.title": "Mit der HEAD-Krone zurücksetzen",
  "tutorial.reset.body":
    "Ziehe die HEAD-Krone auf einen älteren Commit auf main, um main dorthin zurückzusetzen. Normales Ziehen ist ein Mixed-Reset; mit Shift wird es ein Hard-Reset (verwirft Änderungen), mit Strg/⌘ ein Soft-Reset. Bestätige, um fortzufahren.",
  "tutorial.reset.hint": "Ziehe die Krone auf einen älteren Commit auf main.",
  "tutorial.undoReset.title": "Den Reset rückgängig machen",
  "tutorial.undoReset.body":
    "Resets lassen sich leicht zurücknehmen. Klicke auf Rückgängig, damit main wieder genau dort steht, wo es war.",
  "tutorial.undoReset.hint":
    "Klicke in der Symbolleiste auf die Schaltfläche Rückgängig.",
  "tutorial.checkout.title": "Einen Branch auschecken",
  "tutorial.checkout.body":
    "Doppelklicke auf den Chip feature/theme, um zu ihm zu wechseln. Die Krone wandert und zeigt den Branch, auf dem du jetzt bist.",
  "tutorial.checkout.hint": "Doppelklicke auf den Chip feature/theme.",
  "tutorial.openDetail.title": "Commit-Details öffnen",
  "tutorial.openDetail.body":
    "Klicke auf den Commit „Add config“. Sein Detailbereich listet jede Datei auf, die dieser Commit geändert hat – darunter eine Secrets-Datei, die nie hätte committet werden dürfen.",
  "tutorial.openDetail.hint": "Klicke auf den Commit „Add config“.",
  "tutorial.purge.title": "Eine Datei aus dem Verlauf entfernen",
  "tutorial.purge.body":
    "secrets.env darf nicht im Verlauf bleiben. Verwende im Detailbereich bei secrets.env „Datei aus Verlauf entfernen“. ADGitter schreibt diesen Commit und jeden späteren neu und bittet dich um Bestätigung.",
  "tutorial.purge.hint": "Entferne secrets.env aus dem Verlauf.",
  "tutorial.addFile.title": "Eine Datei zu einem früheren Commit hinzufügen",
  "tutorial.addFile.body":
    "Wir haben eine sichere Vorlage, secrets.example.env, in deinem Arbeitsordner abgelegt. Wähle im Detailbereich „Datei hinzufügen“ und füge sie zum Commit „Add config“ hinzu, damit der Verlauf ein harmloses Beispiel behält.",
  "tutorial.addFile.hint":
    "Füge secrets.example.env zum Commit „Add config“ hinzu.",
  "tutorial.reword.title": "Eine Commit-Nachricht korrigieren",
  "tutorial.reword.body":
    "Der Commit „Add drak theme“ enthält einen Tippfehler. Wähle ihn aus, klicke in seinem Detailbereich auf „Commit-Nachricht bearbeiten“ und ändere sie in „Add dark theme“.",
  "tutorial.reword.hint": "Bearbeite die Nachricht von „Add drak theme“.",
  "tutorial.pushRejected.title": "Deine Arbeit pushen",
  "tutorial.pushRejected.body":
    "Klicke auf Push. Git wird ablehnen: Du hast Verlauf umgeschrieben, der bereits im Remote existiert, daher baut dein Branch nicht mehr darauf auf, und ein normaler Push wird als Non-Fast-Forward zurückgewiesen.",
  "tutorial.pushRejected.hint": "Klicke in der Symbolleiste auf Push.",
  "tutorial.forcePush.title": "Force Push",
  "tutorial.forcePush.body":
    "Wenn das Umschreiben des Verlaufs Absicht ist, ersetzt ein Force Push den Remote-Branch durch deinen. Öffne das Menü „Weitere Push-Optionen“, wähle Force Push und bestätige. Verwende ihn bei gemeinsam genutzten Branches mit Vorsicht.",
  "tutorial.forcePush.hint": "Öffne die Push-Optionen und wähle Force Push.",
  "tutorial.logIntro.title": "Log Anytime",
  "tutorial.logIntro.body":
    "Log Anytime sichert still und leise Snapshots deines Arbeitsordners auf einem eigenen Branch, solange ADGitter geöffnet ist – ein Sicherheitsnetz für Arbeit, die du nie committen konntest. Als Nächstes schaltest du es ein.",
  "tutorial.logOn.title": "Log Anytime einschalten",
  "tutorial.logOn.body":
    "Klicke in der Symbolleiste auf die Schaltfläche Log Anytime. Ein blinkender roter Punkt zeigt, dass aufgezeichnet wird.",
  "tutorial.logOn.hint": "Klicke auf die Schaltfläche Log Anytime.",
  "tutorial.logSim.title": "Snapshots erscheinen",
  "tutorial.logSim.body":
    "Damit du nicht warten musst, hat ADGitter ein paar Snapshots simuliert. Du findest sie im Graphen auf dem Branch adgitter-log; echte Snapshots landen dort im von dir gewählten Intervall.",
  "tutorial.logOff.title": "Wieder ausschalten",
  "tutorial.logOff.body":
    "Klicke noch einmal auf die Schaltfläche Log Anytime, um die Aufzeichnung zu beenden. Der rote Punkt verschwindet.",
  "tutorial.logOff.hint": "Klicke erneut auf die Schaltfläche Log Anytime.",
  "tutorial.theme.title": "Ein Thema auswählen",
  "tutorial.theme.body":
    "Öffne die Einstellungen (das Zahnrad), gehe zu Personalisieren, wende ein Graph-Thema an, das dir gefällt, und klicke auf OK. Kostenlose Themen funktionieren offline.",
  "tutorial.theme.hint":
    "Öffne die Einstellungen, wende ein anderes Thema an und klicke dann auf OK.",
  "tutorial.issueBranch.title": "Einen Branch aus einem Issue erstellen",
  "tutorial.issueBranch.body":
    "Öffne das Issues-Panel und erstelle einen Branch für ein Issue; ADGitter benennt den Branch für dich und verknüpft beide. In diesem Tutorial sind die Issues Beispiele – es wird nichts irgendwohin gesendet.",
  "tutorial.issueBranch.hint":
    "Öffne Issues und erstelle einen Branch für ein Issue.",
  "tutorial.issueStatus.title": "Das Issue aktuell halten",
  "tutorial.issueStatus.body":
    "Ändere während der Arbeit den Status des Issues, zum Beispiel auf In Bearbeitung, ohne ADGitter zu verlassen.",
  "tutorial.issueStatus.hint": "Ändere den Status des Issues im Panel.",
  "tutorial.finish.title": "Alles bereit",
  "tutorial.finish.body":
    "Das war die Tour. Das Demo-Repository wird jetzt entfernt. Danach zeigt dir eine kurze Anleitung, wie du dein eigenes Repository öffnest, ein Remote einrichtest und Zugriffstoken erstellst. Du kannst dieses Tutorial jederzeit über das Kontomenü erneut abspielen.",
  "tutorial.finish.primary": "ADGitter verwenden",
};
