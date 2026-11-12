import type { Catalog } from "../messages";

// French (Français) — full translation of the en source. Keys mirror `en`
// exactly; ${…} placeholders are preserved verbatim.
export const fr: Catalog = {
  "common.cancel": "Annuler",
  "common.confirm": "Confirmer",
  "common.ok": "OK",
  "common.create": "Créer",
  "common.open": "Ouvrir",
  "common.reset": "Réinitialiser",
  "common.dismiss": "Ignorer",
  "topbar.repoFallback": "Nom_du_dépôt",
  "topbar.searchScope": "ce projet",
  "topbar.settings": "Paramètres",
  "topbar.account": "Compte",
  "topbar.back": "Retour aux dépôts",
  "search.placeholder": "Rechercher des commits, branches, tags…",
  "search.noResults": "Aucun résultat",
  "search.scope.commits": "Commits",
  "search.scope.message": "Message",
  "search.scope.author": "Auteur",
  "search.scope.hash": "Hash",
  "search.scope.time": "Heure",
  "search.scope.branch": "Branche",
  "search.scope.tag": "Tag",
  "search.placeholder.commits": "Rechercher des commits…",
  "search.placeholder.message": "Rechercher dans les messages de commit…",
  "search.placeholder.author": "Rechercher par nom ou e-mail d’auteur…",
  "search.placeholder.hash": "Rechercher par hash de commit…",
  "search.placeholder.time":
    "Rechercher par date, p. ex. 2026-08 ou 2026-08-19…",
  "search.placeholder.branch": "Rechercher des branches…",
  "search.placeholder.tag": "Rechercher des tags…",
  "logAnytime.enable": "Activer Log Anytime",
  "logAnytime.desc":
    "Tant que l'application est ouverte, prend un instantané de votre arbre de travail sur une branche dédiée, à intervalles réguliers — un filet de sécurité auquel vous pouvez revenir.",
  "logAnytime.branch": "Branche de journalisation",
  "logAnytime.interval": "Instantané toutes les",
  "logAnytime.minutes": "minutes",
  "logAnytime.paidSection": "Arrière-plan et compaction (Advance+)",
  "logAnytime.background": "Exécuter en arrière-plan",
  "logAnytime.periodicSquash": "Compaction périodique",
  "logAnytime.autoPush": "Push automatique",
  "logAnytime.locked": "Nécessite le forfait Advance",
  "logAnytime.compactNow": "Compacter maintenant",
  "logAnytime.compacting": "Compaction en cours…",
  "logAnytime.compactDone": "Historique de journalisation compacté.",
  "logAnytime.compactNoop": "Déjà compact.",
  "logAnytime.compactFailed": "La compaction n'est pas disponible.",
  "logAnytime.noRepo": "Ouvrez un dépôt pour configurer Log Anytime.",
  "crash.title": "Une erreur s'est produite",
  "crash.body":
    "ADGitter a rencontré une erreur inattendue. Votre dépôt est en sécurité sur le disque.",
  "crash.reported": "Un rapport de diagnostic a été envoyé.",
  "crash.reload": "Recharger",
  "crash.dismiss": "Ignorer",
  "user.language": "Langue",
  "user.upgrade": "Passer à un forfait supérieur",
  "user.logout": "Se déconnecter",
  "user.replayTutorial": "Revoir la visite guidée",
  "user.signIn": "Se connecter",
  "user.signingIn": "Continuez dans le navigateur…",
  "user.signedOut": "Non connecté",
  "user.signInUnavailable": "Connexion non configurée",
  "user.planCurrent": "Forfait actuel : {plan}",
  "user.manageSubscription": "Gérer l'abonnement",
  "user.manageSubscriptionTitle":
    "Forfait le plus élevé — résilier, changer de moyen de paiement ou consulter les factures",
  "portal.noSubscription": "Aucun abonnement trouvé pour ce compte.",
  "welcome.greeting": "Bienvenue",
  "welcome.greetingName": "Bienvenue {name}",
  "welcome.newOpen": "Nouveau / Ouvrir",
  "welcome.removeRecent": "Retirer des éléments récents",
  "tutorialUi.dialogLabel": "Tutoriel interactif",
  "tutorialUi.progressLabel": "Étape {index} sur {total}",
  "tutorialUi.back": "Précédent",
  "tutorialUi.next": "Suivant",
  "tutorialUi.continue": "Continuer",
  "tutorialUi.retry": "Réessayer",
  "tutorialUi.working": "Traitement en cours…",
  "tutorialUi.blockedHint":
    "Seule la zone en surbrillance est active pour l'instant. Suivez les instructions de cette carte.",
  "tutorialUi.exit": "Quitter le tutoriel",
  "tutorialUi.exitConfirmTitle": "Quitter le tutoriel ?",
  "tutorialUi.exitConfirmBody":
    "Le dépôt de démonstration sera supprimé. Vous pouvez rejouer le tutoriel à tout moment depuis le menu du compte.",
  "tutorialUi.exitKeep": "Poursuivre",
  "tutorialUi.exitConfirm": "Quitter",
  "welcomeTour.title": "Bienvenue dans ADGitter",
  "welcomeTour.intro":
    "Un client Git que l'on pilote avec des gestes. Voici ce que vous pouvez faire :",
  "welcomeTour.graph.title": "Un graphe que l'on touche",
  "welcomeTour.graph.body":
    "Tout votre historique sous forme de carte claire, voie par voie. Cliquez, sélectionnez par zone et faites glisser directement dessus.",
  "welcomeTour.drag.title": "Glissez pour fusionner, rebaser, cherry-pick",
  "welcomeTour.drag.body":
    "Déposez une branche ou un commit sur un autre, et ADGitter vous pose la seule question qui compte.",
  "welcomeTour.undo.title": "Annulation en un clic",
  "welcomeTour.undo.body":
    "Vous avez changé d'avis après une fusion, un rebase ou un reset ? Annulez et continuez.",
  "welcomeTour.surgery.title": "Chirurgie de l'historique",
  "welcomeTour.surgery.body":
    "Supprimez un fichier qui n'aurait jamais dû être commité, ajoutez-en un oublié ou corrigez un ancien message de commit.",
  "welcomeTour.logAnytime.title": "La machine à remonter le temps Log Anytime",
  "welcomeTour.logAnytime.body":
    "Prend des instantanés de votre travail en arrière-plan, pour que vous puissiez revenir à n'importe quel moment.",
  "welcomeTour.themes.title": "Thèmes",
  "welcomeTour.themes.body":
    "Personnalisez le graphe avec les couleurs et les styles de la boutique de thèmes.",
  "welcomeTour.issues.title": "Suivi des tickets intégré",
  "welcomeTour.issues.body":
    "Connectez Jira, Asana, GitLab ou GitHub, puis créez une branche depuis un ticket et mettez-le à jour au fil de votre travail.",
  "welcomeTour.next": "Suivant",
  "welcomeTour.back": "Précédent",
  "welcomeTour.pageLabel": "Page {page} sur {total}",
  "welcomeTour.choiceTitle": "Comment souhaitez-vous commencer ?",
  "welcomeTour.startTitle": "Lancer le tutoriel interactif",
  "welcomeTour.startBody":
    "Exercez-vous à chaque geste sur un dépôt de démonstration jetable. Vos propres projets ne sont jamais touchés.",
  "welcomeTour.directTitle": "Utiliser ADGitter directement",
  "welcomeTour.directBody":
    "Passez le tutoriel. Vous pouvez le rejouer à tout moment depuis le menu du compte.",
  "firstUse.title": "Premiers pas",
  "firstUse.pageLabel": "Page {page} sur {total}",
  "firstUse.next": "Suivant",
  "firstUse.back": "Précédent",
  "firstUse.close": "Fermer",
  "firstUse.repo.title": "Commencer avec un dépôt",
  "firstUse.repo.intro":
    "ADGitter travaille sur un dépôt Git situé dans un dossier de votre ordinateur. Les deux méthodes commencent sur l'écran d'accueil.",
  "firstUse.repo.createTitle": "Créer un dépôt vide",
  "firstUse.repo.createBody":
    "Cliquez sur Nouveau / Ouvrir, choisissez un dossier qui n'est pas encore un projet Git et confirmez avec Créer. ADGitter exécute git init pour vous.",
  "firstUse.repo.openTitle": "Ouvrir un dépôt existant",
  "firstUse.repo.openBody":
    "Cliquez sur Nouveau / Ouvrir et choisissez un dossier qui contient déjà un projet Git, ou cliquez sur l'avatar d'un projet récent pour y revenir directement.",
  "firstUse.remote.title": "Connecter un dépôt distant",
  "firstUse.remote.intro":
    "Un dépôt distant sur GitHub, GitLab, Bitbucket ou Azure DevOps est l'endroit où vous sauvegardez et partagez vos commits.",
  "firstUse.remote.cloneTitle": "Partir d'un dépôt distant",
  "firstUse.remote.cloneBody":
    "Dans Nouveau / Ouvrir, choisissez « Cloner un dépôt distant », collez son URL Git, choisissez un emplacement et ajoutez un jeton d'accès si le dépôt est privé.",
  "firstUse.remote.settingsTitle": "Ajouter un dépôt distant à un dépôt local",
  "firstUse.remote.settingsBody":
    "Commencez par créer un dépôt vide chez votre fournisseur. Ouvrez ensuite Paramètres → Général → Dépôt distant et authentification, puis saisissez son URL HTTPS et votre jeton d'accès.",
  "firstUse.remote.sshHint":
    "Vous préférez SSH ? Laissez l'URL distante vide et ADGitter se connecte avec votre clé SSH.",
  "firstUse.tokens.title": "Jetons d'accès personnels",
  "firstUse.tokens.intro":
    "Un jeton d'accès personnel (PAT) est une clé semblable à un mot de passe qui permet à ADGitter de faire un push, un pull ou de lire des tickets à votre place, sans votre vrai mot de passe. Créez-le sur le site du fournisseur, copiez-le aussitôt et collez-le dans ADGitter.",
  "firstUse.tokens.where":
    "Les jetons Git se saisissent dans Paramètres → Général → Jeton d'accès. Les jetons des outils de suivi de tickets se saisissent dans Paramètres → Panneau des tickets.",
  "firstUse.tokens.safety":
    "Traitez un jeton comme un mot de passe : ne lui accordez que l'accès nécessaire, définissez une date d'expiration et ne le partagez ni ne le commitez jamais.",
  "firstUse.tokens.tabGit": "Fournisseurs Git",
  "firstUse.tokens.tabIssues": "Outils de suivi de tickets",
  "firstUse.tokens.openPage": "Ouvrir la page des jetons",
  "firstUse.tokens.scopes": "Accès requis",
  "firstUse.tokens.steps": "Comment en créer un",
  "firstUse.git.github.scopes":
    "Jeton classique : la portée repo. Jeton à granularité fine : Repository permissions → Contents: Read and write.",
  "firstUse.git.github.steps":
    "Ouvrez Settings → Developer settings → Personal access tokens.\nChoisissez Generate new token.\nDéfinissez l'accès ci-dessus, générez le jeton et copiez-le. GitHub ne l'affiche qu'une seule fois.",
  "firstUse.git.gitlab.scopes":
    "Les portées read_repository et write_repository (ou api).",
  "firstUse.git.gitlab.steps":
    "Ouvrez User settings → Access tokens et choisissez Add new token.\nDonnez-lui un nom, définissez une date d'expiration et cochez les portées ci-dessus.\nCréez le jeton et copiez-le.",
  "firstUse.git.bitbucket.scopes":
    "Un Repository Access Token avec Repositories: Write (Read est inclus). Les mots de passe d'application ne fonctionnent plus.",
  "firstUse.git.bitbucket.steps":
    "Ouvrez votre dépôt, puis Repository settings → Security → Access tokens.\nChoisissez Create Repository Access Token et donnez-lui un nom.\nCochez Repositories: Write (Read est inclus), créez-le, puis copiez le jeton et utilisez-le comme jeton d'accès dans ADGitter.",
  "firstUse.git.azure.scopes": "Code: Read & write.",
  "firstUse.git.azure.steps":
    "Ouvrez User settings → Personal access tokens et choisissez New Token.\nSélectionnez votre organisation et une date d'expiration, puis Custom defined scopes.\nCochez Code: Read & write, créez le jeton et copiez-le.",
  "firstUse.issue.jira.scopes":
    "Un jeton d'API Atlassian (rien à cocher). Votre compte doit avoir l'autorisation de modifier les tickets du projet. Utilisez-le avec votre e-mail Atlassian.",
  "firstUse.issue.jira.steps":
    "Ouvrez la page Atlassian API tokens et choisissez Create API token.\nDonnez-lui un libellé et une date d'expiration.\nCréez-le et copiez le jeton.",
  "firstUse.issue.asana.scopes":
    "Un jeton d'accès personnel, qui a les mêmes droits que votre compte Asana (rien à cocher).",
  "firstUse.issue.asana.steps":
    "Ouvrez My apps dans la console développeur d'Asana.\nChoisissez Create new token et donnez-lui un nom.\nCopiez le jeton.",
  "firstUse.issue.gitlab.scopes": "La portée api.",
  "firstUse.issue.gitlab.steps":
    "Ouvrez User settings → Access tokens et choisissez Add new token.\nDonnez-lui un nom, définissez une date d'expiration et cochez api.\nCréez le jeton et copiez-le.",
  "firstUse.issue.github.scopes":
    "Jeton à granularité fine : Repository permissions → Issues: Read and write. Un jeton classique nécessite plutôt la portée repo.",
  "firstUse.issue.github.steps":
    "Ouvrez Settings → Developer settings → Fine-grained tokens et choisissez Generate new token.\nSélectionnez les dépôts et définissez Issues: Read and write.\nGénérez-le et copiez le jeton.",
  "firstUse.done.title": "Tout est prêt",
  "firstUse.done.body":
    "Ouvrez ou créez un dépôt pour commencer. Vous pouvez rejouer le tutoriel à tout moment depuis le menu du compte.",
  "window.lockedUpsell": "Le multi-fenêtre est une fonctionnalité payante.",
  "toolbar.branches": "Branches et tags",
  "toolbar.files": "Fichiers modifiés",
  "toolbar.push": "Push",
  "toolbar.pushOptions": "Plus d'options de push",
  "toolbar.forcePush": "Push forcé",
  "toolbar.pull": "Pull",
  "toolbar.undo": "Annuler",
  "toolbar.undoBlockedExternal":
    "Annuler n'est pas disponible : ce dépôt a été modifié par un outil externe. Faites une modification ici pour annuler à nouveau.",
  "toolbar.logAnytime": "Log Anytime",
  "status.ahead": "En avance",
  "status.behind": "En retard",
  "status.signedOut": "Non connecté",
  "status.configUnreadable": "Paramètres du dépôt illisibles",
  "status.configUnreadableHint":
    "adgitter.config.json n'a pas pu être lu ; ce dépôt utilise donc les paramètres par défaut. Le fichier d'origine a été copié vers {file} — rien n'a été écrasé.",
  "status.configUnsavableHint":
    "adgitter.config.json n'a pu être ni lu ni copié de côté. Les modifications de paramètres de ce dépôt ne sont PAS enregistrées tant que vous n'avez pas réparé ou déplacé ce fichier — rien ne sera écrasé.",
  "time.today": "Aujourd'hui",
  "time.yesterday": "Hier",
  "empty.openRepo": "Ouvrir un dépôt",
  "empty.openHint": "Choisissez un projet Git local à visualiser.",
  "empty.firstBranch": "Créez votre première branche",
  "openCreate.prompt":
    "Veuillez choisir un emplacement pour ouvrir un projet git existant ou en créer un nouveau",
  "openCreate.targetLocation": "Emplacement cible",
  "openCreate.cloneLink": "Cloner un dépôt distant →",
  "clone.projectLabel": "Nom du projet",
  "clone.gitUrl": "URL Git",
  "clone.location": "Emplacement",
  "clone.pat": "Jeton d'accès personnel (PAT)",
  "clone.patHint":
    "Facultatif : les dépôts https privés nécessitent un jeton (PAT GitHub / jeton d'accès GitLab / jeton d'accès Bitbucket). Laissez vide pour les dépôts publics ou les URL ssh:// (les clés SSH système sont utilisées).",
  "clone.cloning": "Clonage en cours…",
  "confirm.openRepo":
    "Le répertoire choisi contient un dépôt existant. L'ouvrir ?",
  "confirm.createRepo":
    "Le répertoire choisi ne contient pas de projet git. En créer un ici ?",
  "common.close": "Fermer",
  "files.title": "Modifications",
  "files.conflicted": "En conflit",
  "files.staged": "Indexé",
  "files.changed": "Modifié",
  "files.untracked": "Non suivi",
  "files.ignored": "Ignoré",
  "files.loading": "Chargement…",
  "files.clean": "Arbre de travail propre.",
  "files.stage": "Indexer",
  "files.unstage": "Désindexer",
  "files.discard": "Annuler les modifications",
  "files.openFile": "Ouvrir dans l'éditeur par défaut",
  "commit.message": "Message de commit",
  "commit.usingAccountEmail":
    "Aucune git user.email définie ici — ce commit sera signé par {email}.",
  "commit.usingAccountEmailHow":
    "Définissez git config user.email pour committer sous une autre adresse.",
  "commit.title": "Nouveau commit",
  "commit.create": "Commiter {n}",
  "commit.creating": "Commit en cours…",
  "commit.commitStaged": "Committer {count} élément(s) indexé(s)",
  "commit.nothingStaged": "Rien d'indexé",
  "commitDetails.filter": "filtrer",
  "commitDetails.loading": "Chargement des modifications…",
  "commitDetails.noChanges": "Aucune modification de fichier.",
  "commitDetails.history": "Historique du fichier",
  "commitDetails.historyEmpty": "Aucun historique pour ce fichier.",
  "commitDetails.editMessage": "Modifier le message de commit",
  "commitDetails.save": "Enregistrer",
  "commitDetails.copyBranch": "Copier le nom de la branche ({branch})",
  "commitDetails.copyHash": "Copier le hash complet du commit ({sha})",
  "commitDetails.copied": "Copié",
  "commitDetails.viewDiff": "Voir la diff",
  "commitDetails.purgeFile": "Supprimer le fichier de l'historique",
  "commitDetails.linkedIssue": "Ouvrir le ticket lié",
  "commitDetails.addFile": "Ajouter un fichier",
  "commitDetails.addFilePickerTitle":
    "Ajouter un fichier de l'arbre de travail",
  "commitDetails.addFileEmpty":
    "Aucun fichier modifié dans l'arbre de travail.",
  "diff.loading": "Chargement de la diff…",
  "diff.none": "Aucune diff.",
  "diff.noChanges": "Aucune modification.",
  "diff.binary": "Fichier binaire — pas de diff texte.",
  "branchEdit.name": "Nom de la branche",
  "branchEdit.color": "Couleur",
  "branchEdit.upstream": "Amont (upstream)",
  "branchEdit.upstreamNone": "(aucun)",
  "branchesPanel.addTag": "Ajouter un tag ici",
  "branchesPanel.addTagPlaceholder": "Nom du tag",
  "branchesPanel.edit": "Modifier",
  "branchesPanel.fork": "Créer une branche ici",
  "branchesPanel.forkPlaceholder": "Nom de la nouvelle branche",
  "branchesPanel.goToIssue": "Aller au ticket lié",
  "branchesPanel.noUpstream": "Aucun amont configuré",
  "confirmRewrite.note": "Cette action peut être annulée par la suite.",
  "confirmRewrite.messagePlaceholder": "Nouveau message de commit",
  "confirmRewrite.chooseBranch": "Quelle branche est la cible ?",
  "confirmRewrite.chooseSourceBranch": "Quelle branche est la source ?",
  "confirmRewrite.chooseResetTarget":
    "Réinitialiser vers quelle branche ou quel commit ?",
  "general.autoPull": "Pull automatique",
  "general.off": "Désactivé",
  "general.warning": "Avertissement",
  "general.beforeCreateBranch": "Avant de créer une branche",
  "general.beforePush": "Avant le push",
  "general.beforeCommit": "Avant le commit",
  "general.notify": "Notifier",
  "general.always": "Toujours",
  "general.autoPullSeconds": "Temps de réponse",
  "general.seconds": "secondes",
  "autoPull.title": "{before} : faire un pull depuis le distant ?",
  "autoPull.body":
    "Le pull met cette branche à jour avant l’exécution de l’opération. « Pas maintenant » l’exécute sans pull ; « Annuler » l’abandonne.",
  "autoPull.skipped": "« Pas maintenant » : l’opération continue sans pull.",
  "autoPull.cancelled": "« Annuler » : l’opération a été abandonnée.",
  "autoPull.failed":
    "{before} : le pull a échoué, donc rien n’a été exécuté. {reason}",
  "autoPull.conflicted":
    "{before} : le pull s’est arrêté sur des conflits — résolvez-les d’abord ; rien n’a été exécuté.",
  "autoPull.pending":
    "Une demande de pull automatique attend encore une réponse.",
  "general.unstaged": "Fichiers non indexés",
  "general.undoRedo": "Annuler / Rétablir",
  "general.times": "Fois",
  "general.git": "Git",
  "general.dryRun": "Simulation (dry run)",
  "general.gitIdentity": "Identité Git",
  "general.gitName": "Nom Git",
  "general.gitEmail": "E-mail Git",
  "general.useProjectEmail": "Utiliser l’identité du projet",
  "general.gitEmailHintGlobal":
    "Identité Git appliquée à tous les dépôts (~/.gitconfig)",
  "general.gitEmailHintProject":
    "Uniquement ce dépôt (.git/config) ; remplace l’identité Git globale",
  "general.useAccountIdentity": "Utiliser l’identité du compte connecté",
  "general.accountIdentityHint":
    "Uniquement ce dépôt (.git/config) ; remplace par l’identité du compte",
  "general.accountIdentityNoAccount":
    "Connectez-vous pour utiliser l’identité du compte",
  "general.identityFallbackHint":
    "Aucun nom / e-mail n’est défini, la valeur par défaut sera utilisée",
  "general.hideGhosts": "Masquer les commits non référencés",
  "general.hideGhostsHint":
    "Commits conservés uniquement par les sauvegardes d'annulation après une réécriture d'historique",
  "general.remoteHeading": "Dépôt distant et authentification",
  "general.remoteUrl": "URL distante",
  "general.accessToken": "Jeton d'accès",
  "general.authHint":
    "Utilise un jeton d'accès HTTPS (PAT) pour fetch / pull / push. L'authentification par mot de passe n'est pas prise en charge.",
  "general.openTokenPage": "Où obtenir un jeton ?",
  "general.remoteNoRepo":
    "Ouvrez un dépôt pour configurer son URL distante et son jeton d'accès.",
  "general.remoteOverrideHint":
    "Le dépôt distant .git de ce dépôt est {url}. Saisissez une URL ici pour l'utiliser à la place (avec votre jeton) ; laissez-le vide pour conserver le dépôt distant .git et vous connecter avec une clé SSH.",
  "panel.resize": "Glisser pour redimensionner le panneau",
  "remote.notHttps":
    "Un jeton d'accès est défini, mais ce dépôt distant n'est pas une URL HTTPS —— un jeton ne fonctionne que via HTTPS (et fuiterait en http simple). Le push, le pull et la création de demandes de fusion ou de tickets sont désactivés. Effacez le jeton pour vous connecter via SSH, ou passez le dépôt distant à une URL HTTPS.",
  "personalize.graphTheme": "Thème du graphe",
  "personalize.textSize": "Taille du texte",
  "personalize.small": "Petit",
  "personalize.medium": "Moyen",
  "personalize.large": "Grand",
  "personalize.preview": "Aperçu",
  "personalize.apply": "Appliquer",
  "personalize.inUse": "En cours d'utilisation",
  "personalize.font": "Police",
  "personalize.fontSystem": "Système",
  "personalize.fontSans": "Sans-serif",
  "personalize.fontMono": "Monospace",
  "personalize.buy": "Acheter",
  "personalize.owned": "Possédé",
  "personalize.author": "Auteur",
  "personalize.refreshPurchase": "Actualiser les achats",
  "graphTheme.default.description":
    "Le graphe métro intégré — des rails nets et des nœuds pleins.",
  "graphTheme.midnight.description":
    "Un fond bleu nuit et des rails doux et lumineux — reposant pour les yeux le soir.",
  "graphTheme.synthwave.description":
    "Habillage néon rétro-futuriste au coucher de soleil : nœuds lumineux teintés par branche, rails à halo coloré par voie, soleil rayé et lignes de balayage CRT.",
  "graphTheme.blueprint.description":
    "Style dessin technique : fond bleu blueprint, rails hachurés et nœuds en compas de dessinateur.",
  "graphTheme.hero.description":
    "Monde RPG en pixel art : un héros à l'épée et au bouclier, un village et des rails de route en pierre serpentant sur la carte.",
  "shortcut.pressKeys": "Appuyez sur des touches…",
  "shortcut.conflict":
    "Certains raccourcis sont en conflit — résolvez-les avant d'enregistrer.",
  "shortcut.restoreDefaults": "Restaurer les valeurs par défaut",
  "shortcut.action.switchHandTool": "Basculer l'outil main",
  "shortcut.action.pull": "Pull",
  "shortcut.action.push": "Push",
  "shortcut.action.newBranch": "Nouvelle branche",
  "shortcut.action.newTag": "Nouveau tag",
  "shortcut.action.showBranchPanel": "Afficher le panneau Branches",
  "shortcut.action.showTagPanel": "Afficher le panneau Tags",
  "shortcut.action.showSettingPanel": "Afficher le panneau Réglages",
  "menu.cherryPickOnto": "Cherry-pick sur {branch}",
  "menu.revert": "Annuler (revert) ce commit",
  "menu.reword": "Reformuler le message…",
  "menu.squash": "Fusionner en un seul commit (squash)…",
  "menu.resetMixed": "Réinitialiser la branche ici (mixed)",
  "menu.resetHard": "Réinitialiser la branche ici (hard)",
  "menu.drop": "Supprimer ce commit",
  "menu.checkout": "Checkout",
  "menu.mergeIntoParent": "Fusionner {branch} dans…",
  "menu.rebaseOntoParent": "Rebaser sur {branch}…",
  "menu.branchCurrent": "{branch} (actuelle)",
  "menu.checkoutTag": "Tag {tag}",
  "menu.checkoutDetached": "Ce commit ({short}, détaché)",
  "menu.createBranchHere": "Créer une branche ici…",
  "menu.createBranchFrom": "Créer une branche depuis {branch}…",
  "menu.branchProps": "Propriétés…",
  "menu.checkoutRemote": "Checkout…",
  "createBranch.title": "Créer une branche",
  "createBranch.from": "Depuis",
  "createBranch.name": "Nom de la branche",
  "createBranch.placeholder": "feature/ma-branche",
  "remoteAdopt.title": "Suivre cette branche distante ?",
  "remoteAdopt.body":
    "{branch} existe déjà en local mais ne suit rien. Définir {remote} comme amont et faire le checkout ?",
  "remoteAdopt.confirm": "Définir l'amont et checkout",
  "remotePull.title": "Faire un pull pour synchroniser ?",
  "remotePull.body":
    "{branch} a {behind} commit(s) de retard sur {remote}. Faire un pull maintenant pour avancer en fast-forward ?",
  "remotePull.confirm": "Pull",
  "remotePull.skip": "Pas maintenant",
  "notice.remoteInSync":
    "Checkout de {branch} — déjà synchronisée avec {remote}.",
  "notice.remoteLocalAhead":
    "Checkout de {branch} — {ahead} commit(s) d'avance sur {remote} ; rien à récupérer.",
  "notice.remoteDiverged":
    "Checkout de {branch} — {branch} et {remote} ont divergé ({ahead} en avance, {behind} en retard) ; un pull fusionnerait, c'est donc à vous de décider.",
  "notice.remoteUpstreamSet":
    "{branch} suit désormais {remote} et est maintenant la branche active.",
  "notice.remotePullSkipped":
    "Pas de pull — {branch} a toujours {behind} commit(s) de retard sur {remote}.",
  "remoteCheckout.title": "Checkout d'une branche distante",
  "remoteCheckout.body":
    "{name} est une branche distante. Créer une branche locale pour y travailler ?",
  "remoteCheckout.localName": "Nom de la branche locale",
  "remoteCheckout.create": "Créer et checkout",
  "remoteCheckout.detached": "Checkout détaché",
  "checkoutChoice.title": "Choisir une branche à extraire",
  "checkoutChoice.body":
    "Ce commit a plusieurs branches locales. Laquelle voulez-vous extraire ?",
  "op.revert.title": "Annuler le commit (revert)",
  "op.revert.body": "Créer un nouveau commit qui annule « {subject} ».",
  "op.revert.confirm": "Revert",
  "op.cherryPick.titleOne": "Cherry-pick d'un commit",
  "op.cherryPick.titleMany": "Cherry-pick de commits",
  "op.cherryPick.body": "Appliquer {what} sur {branch}.",
  "op.cherryPick.whatOne": "« {subject} »",
  "op.cherryPick.whatMany": "{n} commits",
  "op.cherryPick.confirm": "Cherry-pick",
  "op.reset.title": "Réinitialiser ({mode})",
  "op.reset.body": "Déplacer {branch} vers {short}. {effect}",
  "op.reset.effectHard":
    "Les modifications de l'arbre de travail seront annulées.",
  "op.reset.effectSoft":
    "Les modifications sont conservées et restent indexées.",
  "op.reset.effectKeep":
    "Les modifications sont conservées dans l'arbre de travail.",
  "op.reset.confirm": "Réinitialiser",
  "graph.resetTip.mixed":
    "Reset --mixed · conserve les modifications, non indexées",
  "graph.resetTip.hard": "Reset --hard · annule toutes les modifications",
  "graph.resetTip.soft": "Reset --soft · conserve les modifications indexées",
  "graph.rebaseTip": "Rebaser {branch} sur {short}",
  "graph.backToTop": "Retour en haut",
  "graph.cherryPickTip":
    "Cherry-pick de {n} commits sur une nouvelle branche à {short}",
  "op.drop.title": "Supprimer le commit",
  "op.drop.body":
    "Supprimer « {subject} » et rejouer ses descendants sans lui.",
  "op.drop.confirm": "Supprimer",
  "op.reword.title": "Reformuler le commit",
  "op.reword.body":
    "Modifiez le message de ce commit. Les commits descendants sont réécrits par-dessus.",
  "op.reword.confirm": "Enregistrer le message",
  "op.squash.title": "Fusionner les commits (squash)",
  "op.squash.body":
    "Combiner ces {n} commits en un seul, avec le message ci-dessous. Les commits descendants sont réécrits par-dessus.",
  "op.squash.confirm": "Squash",
  "op.purgeFile.title": "Supprimer le fichier de l'historique",
  "op.purgeFile.body":
    "Supprimer « {path} » de « {subject} » — et de chaque commit après celui-ci, jusqu'à la pointe de la branche. C'est une modification importante : elle réécrit ce commit et tous ses descendants.",
  "op.purgeFile.confirm": "Supprimer le fichier",
  "op.addFile.title": "Ajouter un fichier au commit",
  "op.addFile.body":
    "Écrire « {path} » dans « {subject} » — et dans chaque commit après celui-ci, jusqu'à la pointe de la branche. C'est une modification importante : elle réécrit ce commit et tous ses descendants.",
  "op.addFile.confirm": "Ajouter le fichier",
  "op.merge.title": "Fusionner la branche",
  "op.merge.body":
    "Fusionner {source} dans {branch} (fast-forward si possible).",
  "op.merge.confirm": "Fusionner",
  "op.mergeBranches.body":
    "Fusionner {source} dans {target} (fast-forward si possible).",
  "op.mergeBranches.bodyCheckout":
    "Checkout de {target}, puis fusion de {source} dedans (fast-forward si possible).",
  "op.rebase.title": "Rebaser la branche",
  "op.rebase.body":
    "Rejouer les commits de {branch} sur {onto}. Cela réécrit ces commits.",
  "op.rebase.confirm": "Rebaser",
  "op.rebaseBranch.body":
    "Rejouer les commits de {branch} sur {onto}. Cela réécrit ces commits.",
  "op.rebaseBranch.bodyCheckout":
    "Rejouer les commits de {branch} sur {onto}, puis revenir à votre branche actuelle et restaurer votre arbre de travail exactement tel qu'il est maintenant. Cela réécrit ces commits.",
  "op.cherryPickNewBranch.title": "Cherry-pick sur une nouvelle branche",
  "op.cherryPickNewBranch.bodyOne":
    "Créer une nouvelle branche à {short} et y cherry-pick 1 commit.",
  "op.cherryPickNewBranch.bodyMany":
    "Créer une nouvelle branche à {short} et y cherry-pick {n} commits.",
  "op.cherryPickNewBranch.confirm": "Cherry-pick",
  "op.removeBranch.title": "Supprimer la branche",
  "op.removeBranch.body":
    "Supprimer l'étiquette de branche « {name} ». Les commits accessibles uniquement depuis celle-ci deviennent inaccessibles (conservés jusqu'au garbage collection).",
  "op.removeBranch.confirm": "Supprimer la branche",
  "op.forcePush.title": "Push forcé",
  "op.forcePush.body":
    "Ceci écrase la branche distante avec votre historique local. Les commits poussés par d'autres — et absents de votre historique local — peuvent être perdus définitivement.",
  "op.forcePush.confirm": "Push forcé",
  "resolve.banner":
    "Conflit lors de l'application de {short} ({op} sur {branch}) — résolvez chaque fichier en conflit, indexez-le, puis continuez.",
  "resolve.continue": "Continuer",
  "resolve.abort": "Abandonner",
  "resolve.stageAllFirst":
    "Indexez tous les fichiers en conflit pour continuer.",
  "resolve.abortConfirm.title": "Abandonner l'opération en pause ?",
  "resolve.abortConfirm.body":
    "Tout est restauré à l'état précédant le début de l'opération. Toutes les résolutions de conflit que vous avez effectuées sont abandonnées.",
  "resolve.abortConfirm.confirm": "Abandonner",
  "branch.head": "HEAD",
  "notice.undid": "{op} annulé",
  "notice.nothingToUndo": "Rien à annuler",
  "notice.pulled": "Pull effectué depuis l'amont",
  "notice.pushed": "Push effectué vers l'amont",
  "notice.forcePushed": "Push forcé effectué vers l'amont",
  "notice.dryRunPush": "Simulation — push ignoré",
  "notice.dryRunPull": "Simulation — pull ignoré",
  "notice.commitInFiles":
    "Indexez et commitez vos modifications dans le panneau Fichiers.",
  "notice.reset": "Réinitialisé ({mode}) vers {short}.",
  "notice.purged": "{path} supprimé de l'historique.",
  "notice.addedFile": "{path} ajouté à l'historique.",
  "notice.squashed": "{n} commits fusionnés en un seul.",
  "notice.resolved": "Conflits résolus — {op} terminé.",
  "notice.opAborted": "Opération abandonnée — état précédent restauré.",
  "notice.remapSkipped":
    "Historique réécrit, mais ces branches n'ont pas pu être rebasées automatiquement (leurs modifications sont en conflit) : {branches}",
  "notice.branchCreated": "Branche {name} créée.",
  "notice.detachedAt": "{short} checkout (HEAD détaché).",
  "notice.openFailed":
    "Impossible d'ouvrir {name}. Le retirer des éléments récents ?",
  "notice.remoteCheckedOut":
    "{branch} créée et checkout, suivant le dépôt distant.",
  "notice.detachedCheckedOut": "{name} checkout (HEAD détaché).",
  "settings.general": "Général",
  "settings.shortcut": "Raccourcis",
  "settings.issuePanel": "Panneau des tickets",
  "settings.account": "Compte",
  "settings.personalize": "Personnalisation",
  "settings.themes": "Thèmes",
  "settings.plan": "Forfait",
  "settings.logAnytime": "Log Anytime",
  "settings.devices": "Appareils",
  "settings.scopeRepo": "Enregistré dans ce dépôt",
  "settings.scopeGlobalFallback":
    "Aucun dépôt ouvert — modification des valeurs par défaut de l'application",
  "themeStore.lede":
    "Achetez un thème une fois — il est à vous pour toujours, quel que soit votre forfait.",
  "themeStore.refresh": "Actualiser les achats",
  "themeStore.apply": "Appliquer",
  "themeStore.applied": "Appliqué",
  "themeStore.buy": "Acheter ${price}",
  "themeStore.notForSale": "Pas encore en vente",
  "themeStore.notForSale.hint":
    "Ce thème n'est pas encore proposé à la vente. Revenez plus tard.",
  "themeStore.downloading": "Téléchargement…",
  "themeStore.error.offline":
    "Impossible de télécharger ce thème — vérifiez votre connexion. Votre thème actuel reste inchangé.",
  "themeStore.error.signIn":
    "Connectez-vous pour télécharger ce thème. Votre thème actuel reste inchangé.",
  "themeStore.error.notOwned":
    "Ce thème ne fait pas encore partie de vos achats. Votre thème actuel reste inchangé.",
  "themeStore.error.notFound":
    "Ce thème n'est plus disponible. Votre thème actuel reste inchangé.",
  "themeStore.error.rejected":
    "Ce thème n'a pas passé le contrôle de sécurité et n'a pas été installé. Votre thème actuel reste inchangé.",
  "checkout.signingIn": "En attente de la connexion…",
  "checkout.signInCancelled": "Connexion annulée — aucun achat effectué.",
  "checkout.signInTimedOut":
    "Délai de connexion dépassé — aucun achat effectué.",
  "checkout.signInFailed":
    "La connexion n'a pas pu aboutir — aucun achat effectué.",
  "checkout.signInUnavailable":
    "La connexion n'est pas disponible pour le moment.",
  "checkout.unavailable": "Le paiement n'est pas disponible pour le moment.",
  "checkoutReturn.processing": "Finalisation de votre achat…",
  "checkoutReturn.unlockedTheme":
    "Achat terminé — votre nouveau thème est débloqué et prêt à être appliqué.",
  "checkoutReturn.unlocked": "Achat terminé — votre compte a été mis à jour.",
  "checkoutReturn.pending":
    "La confirmation de paiement n'est pas encore arrivée. Rien n'est perdu — votre achat sera débloqué dès qu'elle arrivera. Réessayez dans quelques minutes ou rouvrez ADGitter.",
  "checkoutReturn.signInNeeded":
    "Connectez-vous pour terminer le déblocage de votre achat.",
  "checkoutReturn.checkAgain": "Vérifier à nouveau",
  "account.signedOut":
    "Connectez-vous pour gérer votre compte et débloquer les fonctionnalités payantes.",
  "account.signIn": "Se connecter",
  "account.signingIn": "Connexion en cours…",
  "account.cancelSignIn": "Annuler",
  "account.signingInHint":
    "Terminez la connexion dans votre navigateur. Le retour ici est automatique.",
  "account.signOut": "Se déconnecter",
  "account.signOutConfirm.title": "Se déconnecter sur cet appareil ?",
  "account.signOutConfirm.body":
    "Se déconnecter supprime la licence enregistrée sur cet appareil : les fonctionnalités payantes et les thèmes achetés deviennent indisponibles. Se reconnecter restaure tout.",
  "account.signOutConfirm.bodyOffline":
    "Vous semblez hors ligne. La connexion étant vérifiée en ligne, vous ne pourrez pas revenir sur ce compte tant que le réseau ne sera pas rétabli. Se déconnecter supprime tout de même la licence enregistrée sur cet appareil : les fonctionnalités payantes et les thèmes achetés deviennent indisponibles. Se reconnecter restaure tout.",
  "account.signOutIncomplete":
    "Vous êtes déconnecté, mais la licence enregistrée sur cet appareil n'a pas pu être supprimée. Les fonctionnalités payantes peuvent rester déverrouillées jusqu'au redémarrage d'ADGitter.",
  "account.name": "Nom",
  "account.email": "E-mail",
  "account.username": "Nom d'utilisateur",
  "account.manageHint":
    "Ces options ouvrent le portail de compte dans votre navigateur.",
  "account.emailCommitDefault":
    "Utilisée comme auteur du commit uniquement lorsque git n'a pas sa propre user.email ; une user.email configurée l'emporte toujours.",
  "account.manageAccount": "Gérer le compte",
  "account.password": "Mot de passe et sécurité",
  "account.mfa": "Authentification à deux facteurs",
  "account.mfaNotConfigured":
    "L'authentification à deux facteurs n'est pas encore activée pour ADGitter : elle n'apparaîtra sur la page de sécurité de Clerk qu'une fois qu'un administrateur l'aura activée.",
  "account.organization": "Organisation",
  "account.payment": "Moyens de paiement",
  "plan.currentBadge": "Actuel",
  "plan.upgrade": "Passer à un forfait supérieur",
  "plan.refresh": "Actualiser les droits",
  "adGate.title": "La version gratuite est financée par la publicité",
  "adGate.body":
    "La version gratuite d’ADGitter affiche une publicité en bas de la fenêtre. Les revenus publicitaires nous permettent de continuer à maintenir et développer le logiciel. Si vous préférez ne pas voir de publicité, vous pouvez passer à une formule payante.",
  "adGate.data":
    "Les publicités sont fournies par Carbon Ads, qui reçoit votre adresse IP et des informations sur votre navigateur lorsqu’une publicité s’affiche.",
  "adGate.privacy": "Politique de confidentialité",
  "adGate.accept": "Accepter la publicité et continuer gratuitement",
  "adGate.buy": "Passer à une formule payante",
  "adGate.signIn": "Déjà payé ? Se connecter",
  "adGate.decline": "Ne pas accepter la publicité",
  "ad.label": "Publicité",
  "ad.fallback":
    "Cet espace publicitaire finance la version gratuite d’ADGitter. Passez à une formule payante pour le retirer.",
  "ad.remove": "Retirer la publicité",
  "crashConsent.label": "Rapports d’erreur",
  "crashConsent.message":
    "Envoyer des rapports de plantage et d’erreur pour nous aider à corriger les problèmes ? Ils passent par Sentry, les adresses e-mail et chemins de fichiers sont retirés, et votre code n’est jamais inclus. Vous pourrez changer d’avis dans Réglages → Confidentialité.",
  "crashConsent.allow": "Autoriser",
  "crashConsent.deny": "Non merci",
  "settings.privacy": "Confidentialité",
  "privacy.crashReports":
    "Envoyer les rapports de plantage et d’erreur (Sentry)",
  "privacy.crashReportsHint":
    "Les adresses e-mail et chemins de fichiers sont retirés au préalable ; aucun code ni diff n’est inclus.",
  "privacy.ads": "Publicité de la version gratuite (Carbon Ads)",
  "privacy.adsPaid":
    "Les formules payantes n’affichent aucune publicité et ne chargent aucun code publicitaire.",
  "privacy.adsWithdrawPay":
    "Vous avez accepté la publicité. Si vous retirez votre consentement, il faudra l’accepter à nouveau ou passer à une formule payante pour continuer à utiliser la version gratuite.",
  "privacy.adsWithdrawFree":
    "Vous avez accepté la publicité. Si vous retirez votre consentement, elle ne s’affichera plus.",
  "privacy.adsNotGiven":
    "Vous n’avez pas accepté la publicité ; aucune n’est chargée.",
  "privacy.adsWithdraw": "Retirer le consentement",
  "trial.offer": "Essayez {plan} gratuitement pendant {days} jours",
  "trial.note":
    "Aucune carte requise, rien n’est facturé. À la fin, vous repassez automatiquement à Free — achetez quand vous voulez pour continuer. Un essai par ordinateur et par compte.",
  "trial.start": "Commencer l’essai gratuit",
  "trial.starting": "Démarrage…",
  "trial.active": "Essai {plan} — se termine le {date}.",
  "trial.ended": "Votre essai {plan} s’est terminé le {date}.",
  "trial.used": "Cet ordinateur ou ce compte a déjà utilisé son essai gratuit.",
  "trial.failed":
    "Impossible de démarrer l’essai pour le moment. Réessayez plus tard.",
  "trial.badge": "Essai",
  "trial.buy": "Acheter {plan}",
  "plan.feature": "Fonctionnalité",
  "plan.free": "Gratuit",
  "plan.basic": "Basic",
  "plan.advance": "Advance",
  "plan.enterprise": "Enterprise",
  "plan.feat.noAd": "Supprimer les publicités",
  "plan.feat.applyTheme": "Appliquer un thème personnalisé",
  "plan.feat.logBackground": "Log Anytime arrière-plan + compaction périodique",
  "plan.feat.tickets": "Tickets de support prioritaires",
  "plan.feat.seats": "Sièges d'équipe",
  "plan.feat.devices": "Appareils simultanés",
  "plan.seatsAddOn": "{seats} (sièges supplémentaires disponibles)",
  "deviceSeat.limitTitle": "Limite d’appareils connectés dépassée",
  "deviceSeat.limitBody":
    "Appuyez sur OK pour déconnecter l’appareil le plus ancien et connecter celui-ci.",
  "devices.usage": "{used} sur {max} appareils",
  "devices.thisDevice": "Cet appareil",
  "devices.remove": "Retirer",
  "devices.lastSeen": "Vu pour la dernière fois {when}",
  "devices.neverSeen": "Jamais vu",
  "devices.empty":
    "Aucun appareil pour le moment. Connectez-vous pour synchroniser cet appareil.",
  "webhook.provider.slack": "Slack",
  "webhook.provider.jira": "Jira",
  "webhook.provider.github": "GitHub",
  "webhook.provider.gitlab": "GitLab",
  "webhook.scope.send_notification": "Envoyer une notification",
  "webhook.scope.commit": "Commit",
  "webhook.scope.leave_comment": "Laisser un commentaire",
  "webhook.scope.create_branch": "Créer une branche",
  "webhook.scope.rename_branch": "Renommer la branche",
  "webhook.scope.delete_branch": "Supprimer la branche",
  "issueProvider.description":
    "Associez un système de suivi externe à ce dépôt. Ses tickets s'ouvrent dans le panneau Tickets et les modifications sont synchronisées.",
  "issueProvider.noRepo":
    "Ouvrez un dépôt pour associer un fournisseur de tickets.",
  "issueProvider.providerLabel": "Fournisseur",
  "issueProvider.deploymentLabel": "Déploiement",
  "issueProvider.deployment.cloud": "Cloud",
  "issueProvider.deployment.selfHosted": "Auto-hébergé",
  "issueProvider.hostUrlLabel": "URL de l'hôte",
  "issueProvider.hostUrlPlaceholder": "https://…",
  "issueProvider.usernameLabel": "E-mail",
  "issueProvider.usernamePlaceholder": "vous@exemple.com",
  "issueProvider.tokenLabel": "Jeton d'accès",
  "issueProvider.tokenPlaceholder": "Collez un jeton d'accès personnel",
  "issueProvider.scopeHint.github":
    "Utilisez un jeton fin (fine-grained) avec la permission « Issues: Read and write ».",
  "issueProvider.scopeHint.gitlab":
    "Utilisez un jeton avec la portée « api » (ou « read_api » pour une lecture seule).",
  "issueProvider.scopeHint.jira":
    "Le compte du jeton doit avoir la permission « Edit issues » sur le projet cible.",
  "issueProvider.scopeHint.asana":
    "Un jeton d'accès personnel hérite des permissions de votre compte Asana.",
  "issueProvider.openTokenPage": "Où puis-je obtenir un jeton ?",
  "issueProvider.scopeLabel": "Portée",
  "issueProvider.scopePlaceholder": "Sélectionner un dépôt / projet…",
  "issueProvider.loadingContainers": "Chargement des projets disponibles…",
  "issueProvider.connect": "Connecter",
  "issueProvider.connecting": "Connexion en cours…",
  "issueProvider.disconnect": "Déconnecter",
  "issueProvider.invalidToken": "La validation du jeton d'accès a échoué.",
  "issueProvider.errHostRequired":
    "Une URL d'hôte est requise pour ce fournisseur.",
  "issueProvider.errEmailRequired":
    "Une adresse e-mail est requise pour Jira Cloud.",
  "issueProvider.errVerifyFailed": "Impossible de vérifier les identifiants.",
  "issueProvider.switchHint":
    "Associer un fournisseur remplace celui actuellement associé à ce dépôt.",
  "issueProvider.boundTo": "Associé à {provider}",
  "issueProvider.state.disconnected": "Déconnecté",
  "issueProvider.state.connected": "Connecté",
  "issueProvider.state.error": "Erreur",
  "issueProvider.provider.jira": "Jira",
  "issueProvider.provider.asana": "Asana",
  "issueProvider.provider.gitlab": "GitLab",
  "issueProvider.provider.github": "GitHub",
  "issueProvider.credentialSaved": "Jeton d’accès enregistré {masked}",
  "issueProvider.credentialSavedHint":
    "Conservé dans le trousseau du système et réutilisé automatiquement au prochain démarrage.",
  "issueProvider.replaceToken": "Remplacer",
  "issueProvider.cancelReplace": "Conserver le jeton enregistré",
  "issueProvider.reconnecting": "Reconnexion avec le jeton enregistré…",
  "issueProvider.errCredentialRejected":
    "Le fournisseur a refusé le jeton d’accès enregistré : il a probablement été révoqué ou a expiré. Choisissez « Remplacer » et collez-en un nouveau.",
  "issueProvider.errReconnectOffline":
    "Le fournisseur est injoignable, le jeton enregistré n’a donc pas été revérifié. Il reste conservé ; réessayez une fois reconnecté.",
  "issueProvider.errTokenNotSaved":
    "Connexion établie, mais le jeton n’a pas pu être écrit dans le trousseau du système : il ne sera pas là au prochain démarrage.",
  "issueProvider.scopeFilterPlaceholder": "Saisissez pour filtrer…",
  "issueProvider.scopeNoMatches": "Aucun projet correspondant",
  "error.REPO_NOT_FOUND": "Dépôt introuvable",
  "error.INVALID_PATH": "Chemin invalide",
  "error.GIT_ERROR": "Erreur Git",
  "error.IO_ERROR": "Erreur du système de fichiers",
  "error.INTERNAL_ERROR": "Une erreur s'est produite",
  "error.FEATURE_LOCKED": "Cette fonctionnalité nécessite un forfait payant",
  "error.LICENSE_DEVICE_MISMATCH":
    "Cette licence est enregistrée sur un autre appareil — reconnectez-vous pour l'utiliser sur celui-ci",
  "error.LICENSE_EXPIRED":
    "Votre licence a expiré — renouvelez-la pour continuer à utiliser les fonctionnalités payantes",
  "error.NOT_SIGNED_IN": "Connectez-vous pour continuer",
  "error.NO_SUBSCRIPTION": "Aucun abonnement trouvé",
  "error.CONFLICT": "Conflit",
  "error.REMOTE_UPSTREAM_MISMATCH":
    "Cette branche locale suit une autre branche distante",
  "error.MERGE_COMMIT_IN_RANGE":
    "Impossible de réécrire l'historique à travers un commit de fusion",
  "error.conflict":
    "{short} est en conflit avec la cible — résolvez-le manuellement ou annulez l'opération.",
  "toolbar.issues": "Tickets",
  "issue.search": "Rechercher des tickets…",
  "issue.backToList": "Retour à la liste des tickets",
  "issue.overflow": "Plus d'actions",
  "issue.refresh": "Actualiser depuis le fournisseur",
  "issue.lockedUpsell": "Le suivi des tickets est une fonctionnalité Advance.",
  "issue.boundBranch": "Branche associée",
  "issue.linkedBranches": "Branches liées",
  "issue.empty.title": "Tickets",
  "issue.empty.pick": "Choisissez un ticket à ouvrir.",
  "issue.empty.none": "Le projet lié ne contient encore aucun ticket.",
  "issue.empty.projectsFailed": "Impossible de charger les projets.",
  "issue.empty.retryProjects": "Réessayer",
  "issue.empty.pickProject": "Choisissez un projet pour afficher ses tickets.",
  "issue.empty.noMatch": "Aucun ticket ne correspond à votre recherche.",
  "issue.empty.unbound":
    "Aucun gestionnaire de tickets n'est connecté à ce dépôt. Connectez-en un dans [[Réglages → Panneau Tickets]].",
  "issue.empty.credentialMissing":
    "Le jeton d'accès du gestionnaire de tickets de ce dépôt est introuvable. Saisissez-le à nouveau dans [[Réglages → Panneau Tickets]].",
  "issue.empty.loadFailed":
    "Impossible de charger les tickets depuis le gestionnaire. Vérifiez votre connexion, puis le jeton dans [[Réglages → Panneau Tickets]].",
  "issue.hoursUnit": "h",
  "issue.status.created": "Créé",
  "issue.status.in_progress": "En cours",
  "issue.status.done": "Terminé",
  "issue.status.rejected": "Rejeté",
  "issue.field.project": "Projet",
  "issue.field.status": "Statut",
  "issue.field.labels": "Labels",
  "issue.field.assignee": "Assigné",
  "issue.field.due": "Échéance",
  "issue.field.milestone": "Jalon",
  "issue.field.spend": "Dépensé",
  "issue.field.cost": "Coût",
  "issue.dueStart": "Début",
  "issue.dueEnd": "Fin",
  "issue.dueInvalid":
    "La date de début doit être antérieure ou égale à la date de fin.",
  "issue.noAssignee": "Non assigné",
  "issue.noMilestone": "Aucun jalon",
  "issue.noProject": "Aucun projet",
  "issue.addLabel": "Ajouter un label",
  "issue.spendLockedHint": "Modifiable en cours de traitement",
  "issue.field.unsupportedHint": "Non pris en charge par ce tracker : {reason}",
  "issue.field.caveatHint": "À noter : {reason}",
  "issue.field.caveatDestructive":
    "Attention — cela supprime des données : {reason}",
  "issue.error.saveFailed":
    "Impossible d'enregistrer cette modification, elle a été annulée : {reason}",
  "issue.error.refreshFailed": "Impossible d'actualiser ce ticket : {reason}",
  "issue.error.actionFailed": "Cette action ne s'est pas terminée : {reason}",
  "issue.action.new": "Nouveau…",
  "issue.action.reject": "Rejeter",
  "issue.action.start": "Démarrer",
  "issue.action.startNewBranch": "Nouvelle branche et démarrer",
  "issue.action.startJustGo": "Démarrer directement",
  "issue.action.withdraw": "Retirer",
  "issue.action.done": "Terminé",
  "issue.action.doneUpdateSpent": "Mettre à jour la dépense et clôturer",
  "issue.action.doneJustClose": "Clôturer directement",
  "issue.action.reopen": "Rouvrir",
  "issue.rejectedReason": "Rejeté : {reason}",
  "issue.comments.title": "Commentaires",
  "issue.comments.empty": "Aucun commentaire pour le moment.",
  "issue.comments.placeholder": "Écrire un commentaire…",
  "issue.comments.send": "Envoyer",
  "issue.composer.title": "Nouvelle branche et démarrer",
  "issue.composer.type": "Type",
  "issue.composer.desc": "Description courte",
  "issue.composer.preview": "Nom de la branche",
  "issue.composer.confirm": "Créer et checkout",
  "issue.composer.invalid":
    "Saisissez une description pour créer un nom de branche valide.",
  "issue.reject.title": "Rejeter le ticket",
  "issue.reject.prompt":
    "Indiquez une raison pour rejeter ce ticket. Elle est enregistrée sur le ticket.",
  "issue.reject.placeholder": "Raison…",
  "issue.reject.confirm": "Rejeter",
  "issue.reject.required": "Une raison est requise.",
  "issue.new.title": "Nouveau ticket",
  "issue.new.titleField": "Titre",
  "issue.new.project": "Projet",
  "issue.new.labels": "Labels (séparés par des virgules)",
  "issue.new.confirm": "Créer",
  "integration.createMr": "Créer une demande de fusion",
  "integration.createIssue": "Créer un ticket",
  "integration.noToken":
    "Ajoutez un jeton GitHub ou GitLab dans les paramètres Webhooks pour créer des demandes de fusion ou des tickets.",
  "integration.composeMr": "Nouvelle demande de fusion",
  "integration.composeIssue": "Nouveau ticket",
  "integration.titleField": "Titre",
  "integration.target": "Fournisseur",
  "integration.targetBranch": "Branche cible",
  "integration.creating": "Création en cours…",
  "integration.created": "Créé :",
  "integration.authError":
    "Échec de l'authentification — vérifiez le jeton dans les paramètres Webhooks.",
  "integration.failed":
    "Impossible de terminer la requête. Veuillez réessayer.",
  "common.browse": "Parcourir…",
  "branchEdit.title": "Modifier la branche",
  "search.scopeLabel": "Portée de la recherche",
  "graph.commitLabel": "Sélectionner ou déplacer le commit {sha}",
  "graph.commitHint":
    "Cliquez pour sélectionner · glissez sur une branche/un commit pour cherry-pick ou réorganiser",
  "graph.mergeHint": "Glissez sur une autre tête de branche pour fusionner",
  "graph.crownHint":
    "Cliquez pour sélectionner HEAD · glissez sur un commit pour réinitialiser (Shift = réinitialisation forcée, Cmd/Ctrl = réinitialisation douce)",
  "graph.crownLabel": "Sélectionner ou déplacer HEAD",
  "graph.newCommit": "Nouveau commit",
  "menu.dismiss": "Fermer le menu",
  "openCreate.title": "Ouvrir ou créer",
  "openCreate.pathPlaceholder": "/path/to/project",
  "colorPicker.sv": "Saturation et valeur",
  "colorPicker.hue": "Teinte",
  "colorPicker.hex": "Hex",
  "clone.title": "Cloner le dépôt",
  "clone.projectPlaceholder": "my-project",
  "clone.locationPlaceholder": "/path/to/clone/into",
  "diff.close": "Fermer le diff",
  "diff.title": "Diff de fichier",
  "branchesPanel.filter": "filtrer",
  "branchesPanel.localHint":
    "Cliquez pour sélectionner, double-cliquez pour extraire {name}",
  "branchesPanel.cannotDeleteCurrent":
    "Impossible de supprimer la branche actuelle",
  "branchesPanel.delete": "Supprimer",
  "branchesPanel.remoteHint":
    "Double-cliquez ou clic droit pour extraire {name}",
  "branchesPanel.remoteTag": "distante",
  "branchesPanel.deleteTag": "Supprimer le tag",
  "branchesPanel.newTagPlaceholder": "Nouveau tag (à HEAD)",
  "branchesPanel.branchesHeading": "Branches",
  "branchesPanel.tagsHeading": "Tags",
  "themeStore.previewSubject": "objet du commit",
  "tutorial.hint.info": "Cliquez sur Suivant pour continuer.",
  "tutorial.hint.busy": "Un instant, ADGitter prépare tout…",
  "tutorial.welcome.title": "Bienvenue dans ADGitter",
  "tutorial.welcome.body":
    "ADGitter transforme Git en quelque chose que l'on voit et que l'on touche : un graphe de commits vivant où l'on fusionne, rebase, cherry-pick et reset par glisser-déposer. Cette courte visite utilise un dépôt d'entraînement jetable, vos vrais projets restent donc intacts.",
  "tutorial.choose.title": "Faire la visite ?",
  "tutorial.choose.body":
    "Le tutoriel guidé enseigne chaque geste sur un dépôt d'entraînement et dure environ dix minutes. Vous pouvez aussi l'ignorer et utiliser ADGitter directement. Rejouez-le à tout moment depuis le menu du compte.",
  "tutorial.createDemo.title": "Créer un dépôt d'entraînement",
  "tutorial.createDemo.body":
    "ADGitter va créer un petit dépôt de démonstration, avec son propre dépôt distant local, dans le dossier de données de l'application. Il ne touche jamais à vos dépôts, à votre réseau ni à votre compte. Cliquez sur Créer la démo pour commencer.",
  "tutorial.createDemo.hint": "Cliquez sur Créer la démo pour continuer.",
  "tutorial.createDemo.primary": "Créer la démo",
  "tutorial.tourGraph.title": "Lire le graphe",
  "tutorial.tourGraph.body":
    "Chaque ligne est un commit, le plus récent en haut. Les voies colorées montrent comment les branches se séparent et se rejoignent : l'historique se lit comme un plan de métro. Ce dépôt d'entraînement a déjà un peu d'historique : une branche secondaire fusionnée dans main, et une version étiquetée.",
  "tutorial.tourCommit.title": "Un commit",
  "tutorial.tourCommit.body":
    "Chaque cercle est un commit ; celui-ci s'appelle « Write getting-started guide ». Quand deux voies se rejoignent en un seul commit, c'est une fusion : juste au-dessus, repérez « Merge branch 'docs/intro' ». Cliquez sur un commit pour le sélectionner et ouvrir ses détails ; plus tard, vous le ferez glisser pour fusionner, rebaser ou faire un cherry-pick.",
  "tutorial.tourBranch.title": "Pastilles de branche",
  "tutorial.tourBranch.body":
    "La pastille colorée à côté d'un commit est une branche qui pointe vers lui. Cliquez sur une pastille pour sélectionner la branche, double-cliquez dessus pour faire un checkout, ou faites-la glisser sur la branche courante pour la fusionner. Ici, main et docs/intro sont deux branches ; la petite étiquette v0.0.1 marque une version sur le commit de fusion.",
  "tutorial.tourHead.title": "La couronne HEAD",
  "tutorial.tourHead.body":
    "La couronne marque HEAD, le commit sur lequel vous travaillez. La faire glisser sur un commit plus ancien réinitialise votre branche à ce commit — vous allez l'essayer bientôt.",
  "tutorial.tourHandle.title": "La poignée de fusion",
  "tutorial.tourHandle.body":
    "Survolez la pointe d'une branche : une petite poignée ronde apparaît au-dessus. Faites glisser cette poignée sur la pointe d'une autre branche pour fusionner les deux.",
  "tutorial.firstCommit.title": "Faire votre premier commit",
  "tutorial.firstCommit.body":
    "ADGitter vient de créer quelques nouveaux fichiers dans la démo. Ouvrez le panneau « Fichiers modifiés », indexez-les, saisissez un message de commit et validez. Votre commit apparaît aussitôt dans le graphe.",
  "tutorial.firstCommit.hint":
    "Ouvrez le panneau « Fichiers modifiés », indexez les fichiers, puis faites le commit.",
  "tutorial.seedHistory.title": "Un historique plus fourni",
  "tutorial.seedHistory.body":
    "Pour vous entraîner sur un cas réaliste, ADGitter a ajouté d'autres commits, trois branches (feature/login, feature/theme et experiment) et deux tags. Parcourez le graphe, puis cliquez sur Suivant.",
  "tutorial.selectCommit.title": "Sélectionner un commit",
  "tutorial.selectCommit.body":
    "Cliquez sur n'importe quel commit pour le sélectionner. Sélectionner un commit ouvre aussi ses détails, et c'est ainsi que commencent la plupart des gestes.",
  "tutorial.selectCommit.hint": "Cliquez sur un commit dans le graphe.",
  "tutorial.selectMany.title": "Sélectionner plusieurs commits",
  "tutorial.selectMany.body":
    "Tracez un rectangle autour d'au moins deux commits dans une zone vide du graphe, ou maintenez Ctrl (⌘ sur Mac) et cliquez sur d'autres commits. Une sélection multiple peut être déplacée ou copiée en groupe.",
  "tutorial.selectMany.hint": "Sélectionnez au moins deux commits par zone.",
  "tutorial.mergeDrag.title": "Fusionner par glisser-déposer",
  "tutorial.mergeDrag.body":
    "Survolez la pointe de feature/login jusqu'à ce que sa poignée ronde apparaisse, puis faites-la glisser sur main. Confirmez la demande et ADGitter fusionne la branche dans main.",
  "tutorial.mergeDrag.hint":
    "Faites glisser la poignée ronde de feature/login sur main.",
  "tutorial.branchSelect.title": "Sélectionner une branche",
  "tutorial.branchSelect.body":
    "Cliquez sur la pastille feature/theme pour sélectionner toute la branche. Une branche sélectionnée se déplace comme un tout, ce dont vous avez besoin pour la rebaser ensuite.",
  "tutorial.branchSelect.hint": "Cliquez sur la pastille feature/theme.",
  "tutorial.rebase.title": "Rebaser une branche",
  "tutorial.rebase.body":
    "Faites glisser la branche feature/theme sélectionnée sur main pour rejouer ses commits par-dessus le travail le plus récent de main. L'historique est réécrit, donc ADGitter vous demande d'abord de confirmer.",
  "tutorial.rebase.hint": "Faites glisser feature/theme sur la pastille main.",
  "tutorial.cherryPick.title": "Cherry-pick d'un commit",
  "tutorial.cherryPick.body":
    "Cliquez sur le commit « Try faster render » de la branche experiment, puis maintenez Alt (⌥ sur Mac) et faites-le glisser sur la pastille main. Une copie de ce seul commit atterrit sur main.",
  "tutorial.cherryPick.hint":
    "Faites glisser « Try faster render » sur la pastille main en maintenant Alt.",
  "tutorial.undo.title": "Annuler la dernière opération",
  "tutorial.undo.body":
    "Vous avez changé d'avis ? Cliquez sur Annuler dans la barre d'outils pour revenir sur la dernière opération, ici le cherry-pick. Il n'y a pas de rétablissement, alors annulez avec précaution.",
  "tutorial.undo.hint": "Cliquez sur le bouton Annuler dans la barre d'outils.",
  "tutorial.reset.title": "Réinitialiser avec la couronne HEAD",
  "tutorial.reset.body":
    "Faites glisser la couronne HEAD sur un commit plus ancien de main pour y ramener main. Un simple glissement est un reset mixed ; maintenez Shift pour un reset hard (qui supprime les modifications) ou Ctrl/⌘ pour un reset soft. Confirmez pour continuer.",
  "tutorial.reset.hint":
    "Faites glisser la couronne sur un commit plus ancien de main.",
  "tutorial.undoReset.title": "Annuler le reset",
  "tutorial.undoReset.body":
    "Un reset se rattrape facilement. Cliquez sur Annuler pour remettre main exactement où il était.",
  "tutorial.undoReset.hint":
    "Cliquez sur le bouton Annuler dans la barre d'outils.",
  "tutorial.checkout.title": "Faire un checkout d'une branche",
  "tutorial.checkout.body":
    "Double-cliquez sur la pastille feature/theme pour basculer dessus. La couronne se déplace pour montrer la branche sur laquelle vous êtes maintenant.",
  "tutorial.checkout.hint": "Double-cliquez sur la pastille feature/theme.",
  "tutorial.openDetail.title": "Ouvrir les détails d'un commit",
  "tutorial.openDetail.body":
    "Cliquez sur le commit « Add config ». Son panneau de détails liste chaque fichier modifié par ce commit — dont un fichier de secrets qui n'aurait jamais dû être commité.",
  "tutorial.openDetail.hint": "Cliquez sur le commit « Add config ».",
  "tutorial.purge.title": "Supprimer un fichier de l'historique",
  "tutorial.purge.body":
    "secrets.env ne doit pas rester dans l'historique. Dans le panneau de détails, utilisez « Supprimer le fichier de l'historique » sur secrets.env. ADGitter réécrit ce commit et tous les suivants, et vous demande de confirmer.",
  "tutorial.purge.hint": "Supprimez secrets.env de l'historique.",
  "tutorial.addFile.title": "Ajouter un fichier à un ancien commit",
  "tutorial.addFile.body":
    "Nous avons placé un modèle sans risque, secrets.example.env, dans votre dossier de travail. Dans le panneau de détails, choisissez « Ajouter un fichier » et ajoutez-le au commit « Add config », afin que l'historique conserve un exemple inoffensif.",
  "tutorial.addFile.hint":
    "Ajoutez secrets.example.env au commit « Add config ».",
  "tutorial.reword.title": "Corriger un message de commit",
  "tutorial.reword.body":
    "Le commit « Add drak theme » contient une faute de frappe. Sélectionnez-le, choisissez « Modifier le message de commit » dans son panneau de détails et remplacez-le par « Add dark theme ».",
  "tutorial.reword.hint": "Modifiez le message de « Add drak theme ».",
  "tutorial.pushRejected.title": "Faire un push de votre travail",
  "tutorial.pushRejected.body":
    "Cliquez sur Push. Git va refuser : vous avez réécrit un historique qui existe déjà sur le dépôt distant, votre branche ne s'appuie donc plus dessus et un push normal est rejeté comme non fast-forward.",
  "tutorial.pushRejected.hint": "Cliquez sur Push dans la barre d'outils.",
  "tutorial.forcePush.title": "Push forcé",
  "tutorial.forcePush.body":
    "Quand la réécriture de l'historique est voulue, un push forcé remplace la branche distante par la vôtre. Ouvrez le menu « Plus d'options de push », choisissez Push forcé et confirmez. Utilisez-le avec précaution sur les branches partagées.",
  "tutorial.forcePush.hint":
    "Ouvrez les options de push et choisissez Push forcé.",
  "tutorial.logIntro.title": "Log Anytime",
  "tutorial.logIntro.body":
    "Log Anytime prend discrètement des instantanés de votre dossier de travail sur une branche dédiée tant qu'ADGitter est ouvert — un filet de sécurité pour le travail que vous n'avez pas eu le temps de commiter. Vous allez l'activer ensuite.",
  "tutorial.logOn.title": "Activer Log Anytime",
  "tutorial.logOn.body":
    "Cliquez sur le bouton Log Anytime dans la barre d'outils. Un point rouge clignotant indique que l'enregistrement est en cours.",
  "tutorial.logOn.hint": "Cliquez sur le bouton Log Anytime.",
  "tutorial.logSim.title": "Les instantanés apparaissent",
  "tutorial.logSim.body":
    "Pour vous éviter d'attendre, ADGitter a simulé quelques instantanés. Vous les trouverez sur la branche adgitter-log dans le graphe ; les vrais instantanés y arrivent à l'intervalle que vous choisissez.",
  "tutorial.logOff.title": "Le désactiver",
  "tutorial.logOff.body":
    "Cliquez une nouvelle fois sur le bouton Log Anytime pour arrêter l'enregistrement. Le point rouge disparaît.",
  "tutorial.logOff.hint": "Cliquez de nouveau sur le bouton Log Anytime.",
  "tutorial.theme.title": "Choisir un thème",
  "tutorial.theme.body":
    "Ouvrez Paramètres (l'engrenage), allez dans Personnalisation, appliquez un thème de graphe qui vous plaît et cliquez sur OK. Les thèmes gratuits fonctionnent hors ligne.",
  "tutorial.theme.hint":
    "Ouvrez Paramètres, appliquez un autre thème, puis cliquez sur OK.",
  "tutorial.issueBranch.title": "Créer une branche depuis un ticket",
  "tutorial.issueBranch.body":
    "Ouvrez le panneau Tickets et créez une branche pour un ticket ; ADGitter nomme la branche pour vous et relie les deux. Dans ce tutoriel, les tickets sont des exemples — rien n'est envoyé nulle part.",
  "tutorial.issueBranch.hint":
    "Ouvrez Tickets et créez une branche pour un ticket.",
  "tutorial.issueStatus.title": "Garder le ticket à jour",
  "tutorial.issueStatus.body":
    "Pendant que vous travaillez, changez le statut du ticket, par exemple en En cours, sans quitter ADGitter.",
  "tutorial.issueStatus.hint": "Changez le statut du ticket dans le panneau.",
  "tutorial.finish.title": "Tout est prêt",
  "tutorial.finish.body":
    "La visite est terminée. Le dépôt de démonstration va maintenant être supprimé. Ensuite, un court guide explique comment ouvrir votre propre dépôt, configurer un dépôt distant et créer des jetons d'accès. Vous pouvez rejouer ce tutoriel à tout moment depuis le menu du compte.",
  "tutorial.finish.primary": "Commencer à utiliser ADGitter",
};
