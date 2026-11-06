import type { Catalog } from "../messages";

// Japanese (日本語) — full translation of the en source. Keys mirror `en`
// exactly; ${…} placeholders are preserved verbatim.
export const ja: Catalog = {
  "common.cancel": "キャンセル",
  "common.confirm": "確認",
  "common.ok": "OK",
  "common.create": "作成",
  "common.open": "開く",
  "common.reset": "リセット",
  "common.dismiss": "閉じる",
  "topbar.repoFallback": "リポジトリ名",
  "topbar.searchScope": "このプロジェクト",
  "topbar.settings": "設定",
  "topbar.account": "アカウント",
  "topbar.back": "リポジトリ一覧に戻る",
  "search.placeholder": "コミット、ブランチ、タグを検索…",
  "search.noResults": "一致する項目がありません",
  "search.scope.commits": "コミット",
  "search.scope.message": "メッセージ",
  "search.scope.author": "作成者",
  "search.scope.hash": "ハッシュ",
  "search.scope.time": "日時",
  "search.scope.branch": "ブランチ",
  "search.scope.tag": "タグ",
  "search.placeholder.commits": "コミットを検索…",
  "search.placeholder.message": "コミットメッセージを検索…",
  "search.placeholder.author": "作成者名またはメールアドレスを検索…",
  "search.placeholder.hash": "コミットハッシュを検索…",
  "search.placeholder.time": "日付を検索（例: 2026-08、2026-08-19）…",
  "search.placeholder.branch": "ブランチを検索…",
  "search.placeholder.tag": "タグを検索…",
  "logAnytime.enable": "Log Anytime を有効化",
  "logAnytime.desc":
    "アプリを開いている間、作業ツリーを一定間隔で専用ブランチにスナップショットします — いつでも戻れる安全網です。",
  "logAnytime.branch": "ログブランチ",
  "logAnytime.interval": "スナップショット間隔",
  "logAnytime.minutes": "分",
  "logAnytime.paidSection": "バックグラウンド実行 & 圧縮（Advance 以上）",
  "logAnytime.background": "バックグラウンドで実行",
  "logAnytime.periodicSquash": "定期的な圧縮",
  "logAnytime.autoPush": "自動プッシュ",
  "logAnytime.locked": "Advance プランが必要です",
  "logAnytime.compactNow": "今すぐ圧縮",
  "logAnytime.compacting": "圧縮中…",
  "logAnytime.compactDone": "ログ履歴を圧縮しました。",
  "logAnytime.compactNoop": "すでに圧縮済みです。",
  "logAnytime.compactFailed": "圧縮を実行できません。",
  "logAnytime.noRepo": "Log Anytime を設定するにはリポジトリを開いてください。",
  "crash.title": "問題が発生しました",
  "crash.body":
    "ADGitter で予期しないエラーが発生しました。リポジトリはディスク上で安全です。",
  "crash.reported": "診断レポートを送信しました。",
  "crash.reload": "再読み込み",
  "crash.dismiss": "閉じる",
  "user.language": "言語",
  "user.upgrade": "アップグレード",
  "user.logout": "ログアウト",
  "user.replayTutorial": "ガイドツアーをもう一度見る",
  "user.signIn": "サインイン",
  "user.signingIn": "ブラウザで続行してください…",
  "user.signedOut": "サインインしていません",
  "user.signInUnavailable": "サインインは未設定です",
  "user.planCurrent": "現在のプラン：{plan}",
  "user.manageSubscription": "サブスクリプションを管理",
  "user.manageSubscriptionTitle":
    "最上位プラン — 解約、支払い方法の変更、請求書の確認",
  "portal.noSubscription":
    "このアカウントのサブスクリプションが見つかりません。",
  "welcome.greeting": "ようこそ",
  "welcome.greetingName": "ようこそ、{name} さん",
  "welcome.newOpen": "新規 / 開く",
  "welcome.removeRecent": "最近の項目から削除",
  "tutorialUi.dialogLabel": "インタラクティブチュートリアル",
  "tutorialUi.progressLabel": "ステップ {index} / {total}",
  "tutorialUi.back": "戻る",
  "tutorialUi.next": "次へ",
  "tutorialUi.continue": "続行",
  "tutorialUi.retry": "再試行",
  "tutorialUi.working": "処理中…",
  "tutorialUi.blockedHint":
    "現在操作できるのは強調表示されている部分だけです。このカードの案内に従ってください。",
  "tutorialUi.exit": "チュートリアルを終了",
  "tutorialUi.exitConfirmTitle": "チュートリアルを終了しますか？",
  "tutorialUi.exitConfirmBody":
    "デモ用リポジトリは削除されます。チュートリアルはアカウントメニューからいつでもやり直せます。",
  "tutorialUi.exitKeep": "続ける",
  "tutorialUi.exitConfirm": "終了",
  "welcomeTour.title": "ADGitter へようこそ",
  "welcomeTour.intro":
    "ジェスチャーで操作する Git クライアントです。できることをご紹介します。",
  "welcomeTour.graph.title": "触れて操作できるグラフ",
  "welcomeTour.graph.body":
    "履歴全体をレーンごとに見やすいマップで表示します。クリック、範囲選択、ドラッグをその場で行えます。",
  "welcomeTour.drag.title": "ドラッグでマージ、リベース、チェリーピック",
  "welcomeTour.drag.body":
    "ブランチやコミットを別のものにドロップすると、ADGitter が大切な確認を一つだけ行います。",
  "welcomeTour.undo.title": "ワンクリックで元に戻す",
  "welcomeTour.undo.body":
    "マージやリベース、リセットを取り消したくなったら、元に戻してそのまま作業を続けられます。",
  "welcomeTour.surgery.title": "履歴の修正",
  "welcomeTour.surgery.body":
    "コミットすべきでなかったファイルの削除、追加し忘れたファイルの追加、古いコミットメッセージの修正ができます。",
  "welcomeTour.logAnytime.title": "Log Anytime タイムマシン",
  "welcomeTour.logAnytime.body":
    "作業内容をバックグラウンドでスナップショットとして保存するので、いつの時点にでも巻き戻せます。",
  "welcomeTour.themes.title": "テーマ",
  "welcomeTour.themes.body":
    "テーマストアの配色やスタイルで、グラフを自分好みにカスタマイズできます。",
  "welcomeTour.issues.title": "課題トラッカーを内蔵",
  "welcomeTour.issues.body":
    "Jira、Asana、GitLab、GitHub を接続すると、課題からブランチを作成し、作業しながら課題を更新できます。",
  "welcomeTour.next": "次へ",
  "welcomeTour.back": "戻る",
  "welcomeTour.pageLabel": "{page} / {total} ページ",
  "welcomeTour.choiceTitle": "どのように始めますか？",
  "welcomeTour.startTitle": "インタラクティブチュートリアルを始める",
  "welcomeTour.startBody":
    "使い捨てのデモ用リポジトリで、すべてのジェスチャーを練習できます。ご自身のプロジェクトには一切影響しません。",
  "welcomeTour.directTitle": "ADGitter をそのまま使う",
  "welcomeTour.directBody":
    "チュートリアルをスキップします。アカウントメニューからいつでもやり直せます。",
  "firstUse.title": "はじめに",
  "firstUse.pageLabel": "{page} / {total} ページ",
  "firstUse.next": "次へ",
  "firstUse.back": "戻る",
  "firstUse.close": "閉じる",
  "firstUse.repo.title": "リポジトリから始める",
  "firstUse.repo.intro":
    "ADGitter は、お使いのコンピューター上のフォルダーにある Git リポジトリを操作します。どちらの方法も「ようこそ」画面から始まります。",
  "firstUse.repo.createTitle": "空のリポジトリを作成する",
  "firstUse.repo.createBody":
    "「新規 / 開く」をクリックし、まだ Git プロジェクトではないフォルダーを選んで「作成」を確定します。ADGitter が git init を実行します。",
  "firstUse.repo.openTitle": "既存のリポジトリを開く",
  "firstUse.repo.openBody":
    "「新規 / 開く」をクリックして Git プロジェクトのあるフォルダーを選ぶか、最近のプロジェクトのアバターをクリックしてすぐに戻れます。",
  "firstUse.remote.title": "リモートに接続する",
  "firstUse.remote.intro":
    "GitHub、GitLab、Bitbucket、Azure DevOps 上のリモートリポジトリは、コミットをバックアップし共有する場所です。",
  "firstUse.remote.cloneTitle": "リモートから始める",
  "firstUse.remote.cloneBody":
    "「新規 / 開く」で「リモートリポジトリをクローン」を選び、Git URL を貼り付けて保存先を選びます。リポジトリが非公開の場合はアクセストークンも追加してください。",
  "firstUse.remote.settingsTitle": "ローカルリポジトリにリモートを追加する",
  "firstUse.remote.settingsBody":
    "まず、ご利用のプロバイダーで空のリポジトリを作成します。次に「設定 → 一般 → リモートと認証」を開き、その HTTPS URL とアクセストークンを入力します。",
  "firstUse.remote.sshHint":
    "SSH を使いたい場合は、リモート URL を空のままにしてください。ADGitter が SSH キーで接続します。",
  "firstUse.tokens.title": "個人アクセストークン",
  "firstUse.tokens.intro":
    "個人アクセストークン（PAT）は、本物のパスワードを使わずに ADGitter がプッシュやプル、課題の読み取りを代行できるようにする、パスワードのようなキーです。プロバイダーの Web サイトで作成し、すぐにコピーして ADGitter に貼り付けてください。",
  "firstUse.tokens.where":
    "Git のトークンは「設定 → 一般 → アクセストークン」に入力します。課題トラッカーのトークンは「設定 → 課題パネル」に入力します。",
  "firstUse.tokens.safety":
    "トークンはパスワードと同様に扱ってください。必要な権限だけを与え、有効期限を設定し、共有したりコミットしたりしないでください。",
  "firstUse.tokens.tabGit": "Git プロバイダー",
  "firstUse.tokens.tabIssues": "課題トラッカー",
  "firstUse.tokens.openPage": "トークンのページを開く",
  "firstUse.tokens.scopes": "必要なアクセス権",
  "firstUse.tokens.steps": "作成方法",
  "firstUse.git.github.scopes":
    "クラシックトークン: repo スコープ。きめ細かいトークン: Repository permissions → Contents: Read and write。",
  "firstUse.git.github.steps":
    "Settings → Developer settings → Personal access tokens を開きます。\nGenerate new token を選びます。\n上記のアクセス権を設定してトークンを生成し、コピーします。GitHub は一度しか表示しません。",
  "firstUse.git.gitlab.scopes":
    "read_repository と write_repository スコープ（または api）。",
  "firstUse.git.gitlab.steps":
    "User settings → Access tokens を開き、Add new token を選びます。\n名前を付け、有効期限を設定し、上記のスコープにチェックを入れます。\nトークンを作成してコピーします。",
  "firstUse.git.bitbucket.scopes":
    "Repositories: Write（Read を含む）を持つ Repository Access Token。アプリパスワードは使えなくなりました。",
  "firstUse.git.bitbucket.steps":
    "リポジトリを開き、Repository settings → Security → Access tokens を開きます。\nCreate Repository Access Token を選び、名前を付けます。\nRepositories: Write（Read を含む）にチェックを入れて作成し、トークンをコピーして ADGitter のアクセストークンとして使います。",
  "firstUse.git.azure.scopes": "Code: Read & write。",
  "firstUse.git.azure.steps":
    "User settings → Personal access tokens を開き、New Token を選びます。\n組織と有効期限を選び、Custom defined scopes を選択します。\nCode: Read & write にチェックを入れ、トークンを作成してコピーします。",
  "firstUse.issue.jira.scopes":
    "Atlassian の API トークン（チェックする項目はありません）。アカウントにプロジェクトの課題を編集する権限が必要です。Atlassian のメールアドレスと一緒に使います。",
  "firstUse.issue.jira.steps":
    "Atlassian API tokens ページを開き、Create API token を選びます。\nラベルと有効期限を設定します。\n作成してトークンをコピーします。",
  "firstUse.issue.asana.scopes":
    "個人アクセストークン。Asana アカウントと同じアクセス権を持ちます（チェックする項目はありません）。",
  "firstUse.issue.asana.steps":
    "Asana の開発者コンソールで My apps を開きます。\nCreate new token を選び、名前を付けます。\nトークンをコピーします。",
  "firstUse.issue.gitlab.scopes": "api スコープ。",
  "firstUse.issue.gitlab.steps":
    "User settings → Access tokens を開き、Add new token を選びます。\n名前を付け、有効期限を設定し、api にチェックを入れます。\nトークンを作成してコピーします。",
  "firstUse.issue.github.scopes":
    "きめ細かいトークン: Repository permissions → Issues: Read and write。クラシックトークンの場合は、代わりに repo スコープが必要です。",
  "firstUse.issue.github.steps":
    "Settings → Developer settings → Fine-grained tokens を開き、Generate new token を選びます。\nリポジトリを選択し、Issues: Read and write を設定します。\n生成してトークンをコピーします。",
  "firstUse.done.title": "準備完了です",
  "firstUse.done.body":
    "リポジトリを開くか作成して始めましょう。チュートリアルはアカウントメニューからいつでもやり直せます。",
  "window.lockedUpsell": "マルチウィンドウは有料機能です。",
  "toolbar.branches": "ブランチ & タグ",
  "toolbar.files": "変更されたファイル",
  "toolbar.push": "プッシュ",
  "toolbar.pushOptions": "その他のプッシュオプション",
  "toolbar.forcePush": "強制プッシュ",
  "toolbar.pull": "プル",
  "toolbar.undo": "元に戻す",
  "toolbar.undoBlockedExternal":
    "元に戻せません：このリポジトリは ADGitter の外部で変更されました。ここで変更を行うと、また元に戻せるようになります。",
  "toolbar.logAnytime": "Log Anytime",
  "status.ahead": "先行",
  "status.behind": "遅延",
  "status.signedOut": "未サインイン",
  "status.configUnreadable": "リポジトリ設定を読み込めません",
  "status.configUnreadableHint":
    "adgitter.config.json を読み込めなかったため、このリポジトリは既定の設定で動作しています。元のファイルは {file} にコピーされ、上書きはされていません。",
  "status.configUnsavableHint":
    "adgitter.config.json は読み込みもコピーもできませんでした。そのファイルを修正または移動するまで、このリポジトリの設定変更は保存されません（元のファイルも上書きしません）。",
  "time.today": "今日",
  "time.yesterday": "昨日",
  "empty.openRepo": "リポジトリを開く",
  "empty.openHint": "可視化するローカルの Git プロジェクトを選択してください。",
  "empty.firstBranch": "最初のブランチを作成",
  "openCreate.prompt":
    "既存の git プロジェクトを開くか、新しく作成する場所を選択してください",
  "openCreate.targetLocation": "対象の場所",
  "openCreate.cloneLink": "リモートリポジトリをクローン →",
  "clone.projectLabel": "プロジェクトラベル",
  "clone.gitUrl": "Git URL",
  "clone.location": "場所",
  "clone.pat": "個人アクセストークン（PAT）",
  "clone.patHint":
    "任意: プライベートな https リポジトリにはトークンが必要です（GitHub PAT / GitLab アクセストークン / Bitbucket アクセストークン）。公開リポジトリや ssh:// URL の場合は空欄のままで構いません（システムの SSH 鍵が使用されます）。",
  "clone.cloning": "クローン中…",
  "confirm.openRepo":
    "選択したディレクトリには既存のリポジトリがあります。開きますか？",
  "confirm.createRepo":
    "選択したディレクトリに git プロジェクトがありません。ここに作成しますか？",
  "common.close": "閉じる",
  "files.title": "変更",
  "files.conflicted": "競合中",
  "files.staged": "ステージ済み",
  "files.changed": "変更あり",
  "files.untracked": "未追跡",
  "files.ignored": "無視",
  "files.loading": "読み込み中…",
  "files.clean": "作業ツリーはクリーンです。",
  "files.stage": "ステージ",
  "files.unstage": "ステージ解除",
  "files.discard": "変更を破棄",
  "files.openFile": "既定のエディタで開く",
  "commit.message": "コミットメッセージ",
  "commit.usingAccountEmail":
    "ここには git user.email が設定されていません。このコミットの作者は {email} になります。",
  "commit.usingAccountEmailHow":
    "別のアドレスでコミットするには git config user.email を設定してください。",
  "commit.title": "新しいコミット",
  "commit.create": "コミット {n}",
  "commit.creating": "コミット中…",
  "commit.commitStaged": "ステージ済み {count} 件をコミット",
  "commit.nothingStaged": "ステージされた変更はありません",
  "commitDetails.filter": "絞り込み",
  "commitDetails.loading": "変更を読み込み中…",
  "commitDetails.noChanges": "ファイルの変更はありません。",
  "commitDetails.history": "ファイル履歴",
  "commitDetails.historyEmpty": "このファイルの履歴はありません。",
  "commitDetails.editMessage": "コミットメッセージを編集",
  "commitDetails.save": "保存",
  "commitDetails.copyBranch": "ブランチ名をコピー（{branch}）",
  "commitDetails.copyHash": "コミットハッシュ全体をコピー（{sha}）",
  "commitDetails.copied": "コピーしました",
  "commitDetails.viewDiff": "差分を表示",
  "commitDetails.purgeFile": "履歴からファイルを削除",
  "commitDetails.linkedIssue": "リンクされた課題を開く",
  "commitDetails.addFile": "ファイルを追加",
  "commitDetails.addFilePickerTitle": "作業ツリーのファイルを追加",
  "commitDetails.addFileEmpty": "作業ツリーに変更されたファイルはありません。",
  "diff.loading": "差分を読み込み中…",
  "diff.none": "差分はありません。",
  "diff.noChanges": "変更はありません。",
  "diff.binary": "バイナリファイル — テキスト差分はありません。",
  "branchEdit.name": "ブランチ名",
  "branchEdit.color": "色",
  "branchEdit.upstream": "上流ブランチ",
  "branchEdit.upstreamNone": "（なし）",
  "branchesPanel.addTag": "ここにタグを追加",
  "branchesPanel.addTagPlaceholder": "タグ名",
  "branchesPanel.edit": "編集",
  "branchesPanel.fork": "ここから分岐",
  "branchesPanel.forkPlaceholder": "新しいブランチ名",
  "branchesPanel.goToIssue": "リンクされた課題へ移動",
  "branchesPanel.noUpstream": "上流ブランチが未設定です",
  "confirmRewrite.note": "この操作は後から取り消せます。",
  "confirmRewrite.messagePlaceholder": "新しいコミットメッセージ",
  "confirmRewrite.chooseBranch": "対象はどのブランチですか？",
  "confirmRewrite.chooseSourceBranch": "マージ元はどのブランチですか？",
  "confirmRewrite.chooseResetTarget":
    "どのブランチ、またはどのコミットにリセットしますか？",
  "general.autoPull": "自動プル",
  "general.off": "オフ",
  "general.warning": "警告",
  "general.beforeCreateBranch": "ブランチ作成前",
  "general.beforePush": "プッシュ前",
  "general.beforeCommit": "コミット前",
  "general.notify": "通知",
  "general.always": "常に",
  "general.autoPullSeconds": "待ち時間",
  "general.seconds": "秒",
  "autoPull.title": "{before}：リモートからプルしますか？",
  "autoPull.body":
    "プルすると、操作を実行する前にこのブランチが最新になります。「今はしない」はプルしないで実行し、「キャンセル」は操作を中止します。",
  "autoPull.skipped":
    "「今はしない」を選択しました — プルしないで操作を続行します。",
  "autoPull.cancelled": "「キャンセル」を選択しました — 操作を中止しました。",
  "autoPull.failed":
    "{before}：プルに失敗しました — 何も実行していません。{reason}",
  "autoPull.conflicted":
    "{before}：プルで競合が発生しました — 先に競合を解決してください。何も実行していません。",
  "autoPull.pending": "自動プルの確認をまだ待っています。",
  "general.unstaged": "未ステージのファイル",
  "general.undoRedo": "元に戻す / やり直す",
  "general.times": "回",
  "general.git": "Git",
  "general.dryRun": "ドライラン",
  "general.gitIdentity": "Git ID",
  "general.gitName": "Git 名",
  "general.gitEmail": "Git メールアドレス",
  "general.useProjectEmail": "プロジェクトの Git ID を使用",
  "general.gitEmailHintGlobal":
    "Git ID はすべてのリポジトリに適用 (~/.gitconfig)",
  "general.gitEmailHintProject":
    "このリポジトリのみ (.git/config)；グローバル Git ID を上書き",
  "general.useAccountIdentity": "ログイン中のアカウントの Git ID を使用",
  "general.accountIdentityHint":
    "このリポジトリのみ (.git/config)；アカウントの Git ID で上書き",
  "general.accountIdentityNoAccount":
    "アカウントの Git ID を使用するにはログインしてください",
  "general.identityFallbackHint":
    "名前 / メールアドレスが未指定のため、既定値が使用されます",
  "general.hideGhosts": "参照されていないコミットを非表示",
  "general.hideGhostsHint":
    "履歴の書き換え後、元に戻すためのバックアップにのみ残っているコミット",
  "general.remoteHeading": "リモートと認証",
  "general.remoteUrl": "リモート URL",
  "general.accessToken": "アクセストークン",
  "general.authHint":
    "fetch / pull / push には HTTPS アクセストークン（PAT）を使用します。パスワード認証には対応していません。",
  "general.openTokenPage": "トークンはどこで取得できますか？",
  "general.remoteNoRepo":
    "リモート URL とアクセストークンを設定するにはリポジトリを開いてください。",
  "general.remoteOverrideHint":
    "このリポジトリの .git リモートは {url} です。ここに URL を入力するとそちら（トークン付き）を使用します。空のままにすると .git リモートを SSH 鍵で接続します。",
  "panel.resize": "ドラッグしてパネル幅を調整",
  "remote.notHttps":
    "アクセストークンが設定されていますが、このリモートは HTTPS URL ではありません —— トークンは HTTPS でのみ使用でき（平文の http では漏洩します）。プッシュ、プル、マージリクエストや課題の作成は無効です。トークンを消去して SSH で接続するか、リモートを HTTPS URL に変更してください。",
  "personalize.graphTheme": "グラフテーマ",
  "personalize.textSize": "文字サイズ",
  "personalize.small": "小",
  "personalize.medium": "中",
  "personalize.large": "大",
  "personalize.preview": "プレビュー",
  "personalize.apply": "適用",
  "personalize.inUse": "使用中",
  "personalize.font": "フォント",
  "personalize.fontSystem": "システム",
  "personalize.fontSans": "サンセリフ",
  "personalize.fontMono": "等幅",
  "personalize.buy": "購入",
  "personalize.owned": "購入済み",
  "personalize.author": "作者",
  "personalize.refreshPurchase": "購入情報を更新",
  "graphTheme.default.description":
    "組み込みのメトロ グラフ — すっきりしたレールと塗りつぶしノード。",
  "graphTheme.midnight.description":
    "深い紺色のキャンバスに、やわらかく明るいレール。夜でも目にやさしい配色です。",
  "graphTheme.synthwave.description":
    "レトロフューチャーなネオンサンセットのスキン：ブランチ色に光るノード、レーン色のグローレール、ストライプの太陽と CRT スキャンライン。",
  "graphTheme.blueprint.description":
    "製図風のルック：ブループリントブルーの背景、クロスハッチのレール、製図コンパスのノード。",
  "graphTheme.hero.description":
    "ドット絵RPGの世界——剣と盾を持つ勇者、村、そしてマップを縫うように走る石畳の道のレール。",
  "shortcut.pressKeys": "キーを押してください…",
  "shortcut.conflict":
    "一部のショートカットが競合しています — 保存前に解決してください。",
  "shortcut.restoreDefaults": "既定値に戻す",
  "shortcut.action.switchHandTool": "ハンドツールの切り替え",
  "shortcut.action.pull": "プル",
  "shortcut.action.push": "プッシュ",
  "shortcut.action.newBranch": "新しいブランチ",
  "shortcut.action.newTag": "新しいタグ",
  "shortcut.action.showBranchPanel": "ブランチパネルを表示",
  "shortcut.action.showTagPanel": "タグパネルを表示",
  "shortcut.action.showSettingPanel": "設定パネルを表示",
  "menu.cherryPickOnto": "{branch} へチェリーピック",
  "menu.revert": "このコミットを取り消す",
  "menu.reword": "メッセージを変更…",
  "menu.squash": "1つのコミットにスカッシュ…",
  "menu.resetMixed": "ここへブランチをリセット（mixed）",
  "menu.resetHard": "ここへブランチをリセット（hard）",
  "menu.drop": "このコミットを削除",
  "menu.checkout": "チェックアウト",
  "menu.mergeIntoParent": "{branch} にマージ…",
  "menu.rebaseOntoParent": "{branch} にリベース…",
  "menu.branchCurrent": "{branch}（現在）",
  "menu.checkoutTag": "タグ {tag}",
  "menu.checkoutDetached": "このコミット（{short}、detached）",
  "menu.createBranchHere": "ここにブランチを作成…",
  "menu.createBranchFrom": "{branch} からブランチを作成…",
  "menu.branchProps": "プロパティ…",
  "menu.checkoutRemote": "チェックアウト…",
  "createBranch.title": "ブランチを作成",
  "createBranch.from": "起点",
  "createBranch.name": "ブランチ名",
  "createBranch.placeholder": "feature/my-branch",
  "remoteAdopt.title": "このリモートブランチを追跡しますか？",
  "remoteAdopt.body":
    "{branch} はすでにローカルにありますが、何も追跡していません。上流を {remote} に設定してチェックアウトしますか？",
  "remoteAdopt.confirm": "上流を設定してチェックアウト",
  "remotePull.title": "プルして同期しますか？",
  "remotePull.body":
    "{branch} は {remote} より {behind} コミット遅れています。今プルしてファストフォワードしますか？",
  "remotePull.confirm": "プル",
  "remotePull.skip": "今はしない",
  "notice.remoteInSync":
    "{branch} をチェックアウトしました — {remote} と同期済みです。",
  "notice.remoteLocalAhead":
    "{branch} をチェックアウトしました — {remote} より {ahead} コミット進んでおり、プルするものはありません。",
  "notice.remoteDiverged":
    "{branch} をチェックアウトしました — {remote} と分岐しています（{ahead} 先行、{behind} 遅れ）。プルはマージになるため、判断はお任せします。",
  "notice.remoteUpstreamSet":
    "{branch} は {remote} を追跡するようになり、チェックアウトされました。",
  "notice.remotePullSkipped":
    "プルしていません — {branch} は依然として {remote} より {behind} コミット遅れています。",
  "remoteCheckout.title": "リモートブランチをチェックアウト",
  "remoteCheckout.body":
    "{name} はリモートブランチです。作業用のローカルブランチを作成しますか？",
  "remoteCheckout.localName": "ローカルブランチ名",
  "remoteCheckout.create": "作成してチェックアウト",
  "remoteCheckout.detached": "detached でチェックアウト",
  "checkoutChoice.title": "チェックアウトするブランチを選択",
  "checkoutChoice.body":
    "このコミットには複数のローカルブランチがあります。どちらをチェックアウトしますか？",
  "op.revert.title": "コミットを取り消す",
  "op.revert.body": "「{subject}」を取り消す新しいコミットを作成します。",
  "op.revert.confirm": "取り消す",
  "op.cherryPick.titleOne": "コミットをチェリーピック",
  "op.cherryPick.titleMany": "コミットをチェリーピック",
  "op.cherryPick.body": "{what} を {branch} に適用します。",
  "op.cherryPick.whatOne": "「{subject}」",
  "op.cherryPick.whatMany": "{n} 件のコミット",
  "op.cherryPick.confirm": "チェリーピック",
  "op.reset.title": "リセット（{mode}）",
  "op.reset.body": "{branch} を {short} に移動します。{effect}",
  "op.reset.effectHard": "作業ツリーの変更は破棄されます。",
  "op.reset.effectSoft": "変更は保持され、ステージされたままになります。",
  "op.reset.effectKeep": "変更は作業ツリーに保持されます。",
  "op.reset.confirm": "リセット",
  "graph.resetTip.mixed": "reset --mixed · 変更を保持（ステージ解除）",
  "graph.resetTip.hard": "reset --hard · すべての変更を破棄",
  "graph.resetTip.soft": "reset --soft · 変更を保持（ステージ維持）",
  "graph.rebaseTip": "{branch} を {short} にリベース",
  "graph.backToTop": "一番上に戻る",
  "graph.cherryPickTip":
    "{n} 件のコミットを {short} の新しいブランチにチェリーピック",
  "op.drop.title": "コミットを削除",
  "op.drop.body":
    "「{subject}」を削除し、それを含まずに後続のコミットを再適用します。",
  "op.drop.confirm": "削除",
  "op.reword.title": "コミットメッセージを変更",
  "op.reword.body":
    "このコミットのメッセージを編集します。後続のコミットはその上に書き換えられます。",
  "op.reword.confirm": "メッセージを保存",
  "op.squash.title": "コミットをスカッシュ",
  "op.squash.body":
    "これら {n} 件のコミットを下記のメッセージで1つにまとめます。後続のコミットはその上に書き換えられます。",
  "op.squash.confirm": "スカッシュ",
  "op.purgeFile.title": "履歴からファイルを削除",
  "op.purgeFile.body":
    "「{path}」を「{subject}」から、そしてブランチの先端までの以降すべてのコミットから削除します。これは大規模な編集です。このコミットとそのすべての後続コミットが書き換えられます。",
  "op.purgeFile.confirm": "ファイルを削除",
  "op.addFile.title": "コミットにファイルを追加",
  "op.addFile.body":
    "「{path}」を「{subject}」に、そしてブランチの先端までの以降すべてのコミットに書き込みます。これは大規模な編集です。このコミットとそのすべての後続コミットが書き換えられます。",
  "op.addFile.confirm": "ファイルを追加",
  "op.merge.title": "ブランチをマージ",
  "op.merge.body":
    "{source} を {branch} にマージします（可能な場合はファストフォワード）。",
  "op.merge.confirm": "マージ",
  "op.mergeBranches.body":
    "{source} を {target} にマージします（可能な場合はファストフォワード）。",
  "op.mergeBranches.bodyCheckout":
    "{target} をチェックアウトしてから、{source} をマージします（可能な場合はファストフォワード）。",
  "op.rebase.title": "ブランチをリベース",
  "op.rebase.body":
    "{branch} のコミットを {onto} に再適用します。これによりコミットが書き換えられます。",
  "op.rebase.confirm": "リベース",
  "op.rebaseBranch.body":
    "{branch} のコミットを {onto} に再適用します。これによりコミットが書き換えられます。",
  "op.rebaseBranch.bodyCheckout":
    "{branch} のコミットを {onto} に再適用し、その後現在のブランチに戻して作業ツリーを今の状態のまま復元します。これによりコミットが書き換えられます。",
  "op.cherryPickNewBranch.title": "新しいブランチにチェリーピック",
  "op.cherryPickNewBranch.bodyOne":
    "{short} に新しいブランチを作成し、1件のコミットをチェリーピックします。",
  "op.cherryPickNewBranch.bodyMany":
    "{short} に新しいブランチを作成し、{n} 件のコミットをチェリーピックします。",
  "op.cherryPickNewBranch.confirm": "チェリーピック",
  "op.removeBranch.title": "ブランチを削除",
  "op.removeBranch.body":
    "ブランチラベル「{name}」を削除します。このブランチからのみ到達可能だったコミットは到達不能になります（ガベージコレクションされるまで保持されます）。",
  "op.removeBranch.confirm": "ブランチを削除",
  "op.forcePush.title": "強制プッシュ",
  "op.forcePush.body":
    "リモートブランチをローカルの履歴で上書きします。他の人がプッシュし、あなたのローカル履歴に存在しないコミットは永久に失われる可能性があります。",
  "op.forcePush.confirm": "強制プッシュ",
  "resolve.banner":
    "{short} の適用中に競合が発生しました（{branch} 上の {op}）— 各競合ファイルを解決し、ステージしてから続行してください。",
  "resolve.continue": "続行",
  "resolve.abort": "中止",
  "resolve.stageAllFirst":
    "続行するには競合ファイルをすべてステージしてください。",
  "resolve.abortConfirm.title": "一時停止中の操作を中止しますか？",
  "resolve.abortConfirm.body":
    "操作開始前の状態にすべて復元されます。行った競合解決は破棄されます。",
  "resolve.abortConfirm.confirm": "中止",
  "branch.head": "HEAD",
  "notice.undid": "{op} を元に戻しました",
  "notice.nothingToUndo": "元に戻す操作はありません",
  "notice.pulled": "上流からプルしました",
  "notice.pushed": "上流にプッシュしました",
  "notice.forcePushed": "上流に強制プッシュしました",
  "notice.dryRunPush": "ドライラン — プッシュをスキップしました",
  "notice.dryRunPull": "ドライラン — プルをスキップしました",
  "notice.commitInFiles":
    "「ファイル」パネルで変更をステージしてコミットしてください。",
  "notice.reset": "{short} へリセット（{mode}）しました。",
  "notice.purged": "{path} を履歴から削除しました。",
  "notice.addedFile": "{path} を履歴に追加しました。",
  "notice.squashed": "{n} 件のコミットを1つにスカッシュしました。",
  "notice.resolved": "競合を解決しました — {op} が完了しました。",
  "notice.opAborted": "操作を中止しました — 以前の状態を復元しました。",
  "notice.remapSkipped":
    "履歴を書き換えましたが、次のブランチは変更が競合するため自動でリベースできませんでした: {branches}",
  "notice.branchCreated": "ブランチ {name} を作成しました。",
  "notice.detachedAt": "{short} をチェックアウトしました（detached HEAD）。",
  "notice.openFailed":
    "{name} を開けませんでした。最近の項目から削除しますか？",
  "notice.remoteCheckedOut":
    "{branch} を作成してチェックアウトし、リモートを追跡します。",
  "notice.detachedCheckedOut":
    "{name} をチェックアウトしました（detached HEAD）。",
  "settings.general": "一般",
  "settings.shortcut": "ショートカット",
  "settings.issuePanel": "課題パネル",
  "settings.account": "アカウント",
  "settings.personalize": "パーソナライズ",
  "settings.themes": "テーマ",
  "settings.plan": "プラン",
  "settings.logAnytime": "Log Anytime",
  "settings.devices": "デバイス",
  "settings.scopeRepo": "このリポジトリに保存",
  "settings.scopeGlobalFallback":
    "リポジトリが開かれていません — アプリの既定値を編集中",
  "themeStore.lede":
    "テーマは一度購入すれば、どのプランでも永久に使用できます。",
  "themeStore.refresh": "購入情報を更新",
  "themeStore.apply": "適用",
  "themeStore.applied": "適用済み",
  "themeStore.buy": "${price} で購入",
  "themeStore.notForSale": "販売準備中",
  "themeStore.notForSale.hint":
    "このテーマはまだ購入できません。しばらくしてからもう一度ご確認ください。",
  "themeStore.downloading": "ダウンロード中…",
  "themeStore.error.offline":
    "このテーマをダウンロードできませんでした — 接続を確認してください。現在のテーマは変更されていません。",
  "themeStore.error.signIn":
    "このテーマをダウンロードするにはサインインしてください。現在のテーマは変更されていません。",
  "themeStore.error.notOwned":
    "このテーマはまだ購入済みではありません。現在のテーマは変更されていません。",
  "themeStore.error.notFound":
    "このテーマは提供終了しました。現在のテーマは変更されていません。",
  "themeStore.error.rejected":
    "このテーマは安全性チェックに合格しなかったためインストールされませんでした。現在のテーマは変更されていません。",
  "checkout.signingIn": "サインインを待っています…",
  "checkout.signInCancelled":
    "サインインはキャンセルされました — 購入は行われていません。",
  "checkout.signInTimedOut":
    "サインインがタイムアウトしました — 購入は行われていません。",
  "checkout.signInFailed":
    "サインインを完了できませんでした — 購入は行われていません。",
  "checkout.signInUnavailable": "現在サインインできません。",
  "checkout.unavailable": "現在チェックアウトできません。",
  "checkoutReturn.processing": "購入を完了しています…",
  "checkoutReturn.unlockedTheme":
    "購入が完了しました — 新しいテーマがアンロックされ、適用できます。",
  "checkoutReturn.unlocked": "購入が完了しました — アカウントを更新しました。",
  "checkoutReturn.pending":
    "支払いの確認がまだ届いていません。購入は失われていません — 確認が届き次第アンロックされます。数分後にもう一度確認するか、ADGitter を開き直してください。",
  "checkoutReturn.signInNeeded":
    "購入のアンロックを完了するにはサインインしてください。",
  "checkoutReturn.checkAgain": "もう一度確認",
  "account.signedOut":
    "サインインしてアカウントを管理し、有料機能を解放してください。",
  "account.signIn": "サインイン",
  "account.signingIn": "サインイン中…",
  "account.cancelSignIn": "キャンセル",
  "account.signingInHint":
    "ブラウザーでサインインを完了してください。完了すると自動的に戻ります。",
  "account.signOut": "サインアウト",
  "account.signOutConfirm.title": "このデバイスからサインアウトしますか？",
  "account.signOutConfirm.body":
    "サインアウトすると、このデバイスに保存されたライセンスが削除されます。有料機能と購入したテーマが使えなくなります。もう一度サインインすればすべて元に戻ります。",
  "account.signOutConfirm.bodyOffline":
    "オフラインのようです。サインインはオンラインで検証されるため、接続が回復するまでこのアカウントに戻ることはできません。サインアウトすると、このデバイスのライセンスは削除されます。有料機能と購入したテーマが使えなくなります。もう一度サインインすればすべて元に戻ります。",
  "account.signOutIncomplete":
    "サインアウトしましたが、このデバイスのライセンスを削除できませんでした。ADGitter を再起動するまで、有料機能がロックされないままになる場合があります。",
  "account.name": "名前",
  "account.email": "メールアドレス",
  "account.username": "ユーザー名",
  "account.manageHint": "これらはブラウザでアカウントポータルを開きます。",
  "account.emailCommitDefault":
    "git に user.email がない場合にのみコミットの作者として使われます。設定済みの user.email が常に優先されます。",
  "account.manageAccount": "アカウントを管理",
  "account.password": "パスワードとセキュリティ",
  "account.mfa": "二要素認証",
  "account.mfaNotConfigured":
    "ADGitter ではまだ二要素認証が有効になっていないため、管理者が有効にするまで Clerk のセキュリティページには表示されません。",
  "account.organization": "組織",
  "account.payment": "支払い方法",
  "plan.currentBadge": "現在のプラン",
  "plan.upgrade": "アップグレード",
  "plan.refresh": "権利情報を更新",
  "adGate.title": "無料版は広告で支えられています",
  "adGate.body":
    "ADGitter の無料版では、ウィンドウ下部に広告が 1 件表示されます。広告収益によって、本ソフトウェアの保守と開発を続けることができます。広告を表示したくない場合は、有料プランに切り替えられます。",
  "adGate.data":
    "広告は Carbon Ads が配信し、表示時に Carbon Ads はお客様の IP アドレスとブラウザー情報を受け取ります。",
  "adGate.privacy": "プライバシーポリシー",
  "adGate.accept": "広告に同意して無料で使う",
  "adGate.buy": "有料プランに切り替える",
  "adGate.signIn": "購入済みの方はサインイン",
  "adGate.decline": "広告に同意しない",
  "crashConsent.label": "エラーレポート",
  "crashConsent.message":
    "問題の修正に役立てるため、クラッシュとエラーのレポートを送信しますか？レポートは Sentry 経由で送信され、メールアドレスとファイルパスは削除され、コードは含まれません。あとで「設定 → プライバシー」から変更できます。",
  "crashConsent.allow": "許可する",
  "crashConsent.deny": "送信しない",
  "settings.privacy": "プライバシー",
  "privacy.crashReports": "クラッシュとエラーのレポートを送信（Sentry）",
  "privacy.crashReportsHint":
    "メールアドレスとファイルパスは送信前に削除され、コードや差分は含まれません。",
  "privacy.ads": "無料版の広告（Carbon Ads）",
  "privacy.adsPaid":
    "有料プランでは広告を表示せず、広告用のコードも読み込みません。",
  "privacy.adsWithdrawPay":
    "広告に同意済みです。同意を撤回すると、無料版を使い続けるには再度同意するか、有料プランに切り替える必要があります。",
  "privacy.adsWithdrawFree":
    "広告に同意済みです。同意を撤回すると広告は表示されなくなります。",
  "privacy.adsNotGiven": "広告に同意していないため、広告は読み込まれません。",
  "privacy.adsWithdraw": "同意を撤回",
  "trial.offer": "{plan} を {days} 日間無料でお試し",
  "trial.note":
    "カードは不要で、料金は一切発生しません。終了後は自動的に Free に戻ります。続けて使う場合はいつでも購入できます。無料体験はパソコン 1 台・アカウント 1 つにつき 1 回までです。",
  "trial.start": "無料体験を始める",
  "trial.starting": "開始しています…",
  "trial.active": "{plan} を無料体験中（{date} まで）。",
  "trial.ended": "{plan} の無料体験は {date} に終了しました。",
  "trial.used":
    "このパソコンまたはアカウントは、すでに無料体験を利用済みです。",
  "trial.failed":
    "現在、無料体験を開始できません。しばらくしてからもう一度お試しください。",
  "trial.badge": "無料体験中",
  "trial.buy": "{plan} を購入",
  "plan.feature": "機能",
  "plan.free": "Free",
  "plan.basic": "Basic",
  "plan.advance": "Advance",
  "plan.enterprise": "Enterprise",
  "plan.feat.noAd": "広告を削除",
  "plan.feat.applyTheme": "カスタムテーマを適用",
  "plan.feat.logBackground": "Log Anytime のバックグラウンド実行 + 定期圧縮",
  "plan.feat.tickets": "優先サポートチケット",
  "plan.feat.seats": "チームシート",
  "plan.feat.devices": "同時利用デバイス数",
  "plan.seatsAddOn": "{seats}（追加購入可）",
  "deviceSeat.limitTitle": "サインイン済みデバイスの上限を超えました",
  "deviceSeat.limitBody":
    "OK を押すと、最も古いデバイスをサインアウトして、このデバイスでサインインします。",
  "devices.usage": "{max} 台中 {used} 台のデバイス",
  "devices.thisDevice": "このデバイス",
  "devices.remove": "削除",
  "devices.lastSeen": "最終利用 {when}",
  "devices.neverSeen": "利用履歴なし",
  "devices.empty":
    "デバイスがまだありません。サインインしてこのデバイスを同期してください。",
  "webhook.provider.slack": "Slack",
  "webhook.provider.jira": "Jira",
  "webhook.provider.github": "GitHub",
  "webhook.provider.gitlab": "GitLab",
  "webhook.scope.send_notification": "通知を送信",
  "webhook.scope.commit": "コミット",
  "webhook.scope.leave_comment": "コメントを残す",
  "webhook.scope.create_branch": "ブランチを作成",
  "webhook.scope.rename_branch": "ブランチ名を変更",
  "webhook.scope.delete_branch": "ブランチを削除",
  "issueProvider.description":
    "このリポジトリに外部トラッカーを1つ紐付けます。その課題は課題パネルで開かれ、編集内容は同期されます。",
  "issueProvider.noRepo":
    "課題プロバイダーを紐付けるにはリポジトリを開いてください。",
  "issueProvider.providerLabel": "プロバイダー",
  "issueProvider.deploymentLabel": "デプロイ形態",
  "issueProvider.deployment.cloud": "クラウド",
  "issueProvider.deployment.selfHosted": "セルフホスト",
  "issueProvider.hostUrlLabel": "ホスト URL",
  "issueProvider.hostUrlPlaceholder": "https://…",
  "issueProvider.usernameLabel": "メールアドレス",
  "issueProvider.usernamePlaceholder": "you@example.com",
  "issueProvider.tokenLabel": "アクセストークン",
  "issueProvider.tokenPlaceholder": "個人アクセストークンを貼り付け",
  "issueProvider.scopeHint.github":
    "「Issues: Read and write」権限を持つファイングレインドトークンを使用してください。",
  "issueProvider.scopeHint.gitlab":
    "「api」スコープを持つトークンを使用してください（読み取り専用の場合は「read_api」）。",
  "issueProvider.scopeHint.jira":
    "トークンのアカウントは対象プロジェクトで「Edit issues」権限が必要です。",
  "issueProvider.scopeHint.asana":
    "個人アクセストークンはあなたの Asana アカウントの権限を引き継ぎます。",
  "issueProvider.openTokenPage": "トークンはどこで取得できますか？",
  "issueProvider.scopeLabel": "スコープ",
  "issueProvider.scopePlaceholder": "リポジトリ / プロジェクトを選択…",
  "issueProvider.loadingContainers": "利用可能なプロジェクトを読み込み中…",
  "issueProvider.connect": "接続",
  "issueProvider.connecting": "接続中…",
  "issueProvider.disconnect": "切断",
  "issueProvider.invalidToken": "そのアクセストークンは検証に失敗しました。",
  "issueProvider.errHostRequired":
    "このプロバイダーではホスト URL が必須です。",
  "issueProvider.errEmailRequired": "Jira Cloud ではメールアドレスが必須です。",
  "issueProvider.errVerifyFailed": "資格情報を検証できませんでした。",
  "issueProvider.switchHint":
    "プロバイダーを紐付けると、このリポジトリに現在紐付けられているプロバイダーは置き換えられます。",
  "issueProvider.boundTo": "{provider} に紐付け済み",
  "issueProvider.state.disconnected": "未接続",
  "issueProvider.state.connected": "接続済み",
  "issueProvider.state.error": "エラー",
  "issueProvider.provider.jira": "Jira",
  "issueProvider.provider.asana": "Asana",
  "issueProvider.provider.gitlab": "GitLab",
  "issueProvider.provider.github": "GitHub",
  "issueProvider.credentialSaved": "アクセストークンを保存しました {masked}",
  "issueProvider.credentialSavedHint":
    "システムのキーチェーンに保存され、次回起動時に自動で再接続します。",
  "issueProvider.replaceToken": "変更",
  "issueProvider.cancelReplace": "保存済みのトークンを使う",
  "issueProvider.reconnecting": "保存済みのトークンで再接続しています…",
  "issueProvider.errCredentialRejected":
    "保存済みのアクセストークンがプロバイダーに拒否されました。取り消されたか期限切れの可能性があります。「変更」を選び、新しいトークンを貼り付けてください。",
  "issueProvider.errReconnectOffline":
    "プロバイダーに接続できず、保存済みのトークンを再確認できませんでした。トークンは保持されています。オンラインに戻ってから再試行してください。",
  "issueProvider.errTokenNotSaved":
    "接続しましたが、トークンをシステムのキーチェーンに書き込めなかったため、次回起動時には残りません。",
  "issueProvider.scopeFilterPlaceholder": "入力して絞り込み…",
  "issueProvider.scopeNoMatches": "一致するプロジェクトがありません",
  "error.REPO_NOT_FOUND": "リポジトリが見つかりません",
  "error.INVALID_PATH": "無効なパスです",
  "error.GIT_ERROR": "Git エラー",
  "error.IO_ERROR": "ファイルシステムエラー",
  "error.INTERNAL_ERROR": "問題が発生しました",
  "error.FEATURE_LOCKED": "この機能には有料プランが必要です",
  "error.LICENSE_DEVICE_MISMATCH":
    "このライセンスは別のデバイスに登録されています。このデバイスで使うには、もう一度サインインしてください",
  "error.LICENSE_EXPIRED":
    "ライセンスの有効期限が切れています。更新すると有料機能を引き続き利用できます",
  "error.NOT_SIGNED_IN": "続行するにはサインインしてください",
  "error.NO_SUBSCRIPTION": "サブスクリプションが見つかりません",
  "error.CONFLICT": "競合",
  "error.REMOTE_UPSTREAM_MISMATCH":
    "そのローカルブランチは別のリモートブランチを追跡しています",
  "error.MERGE_COMMIT_IN_RANGE": "マージコミットをまたぐ書き換えはできません",
  "error.conflict":
    "{short} が対象と競合しています — 手動で解決するか操作を元に戻してください。",
  "toolbar.issues": "課題",
  "issue.search": "課題を検索…",
  "issue.backToList": "課題一覧に戻る",
  "issue.overflow": "その他の操作",
  "issue.refresh": "プロバイダーから更新",
  "issue.lockedUpsell": "課題追跡は Advance の機能です。",
  "issue.boundBranch": "紐付けブランチ",
  "issue.linkedBranches": "リンクされたブランチ",
  "issue.empty.title": "課題",
  "issue.empty.pick": "開く課題を選択してください。",
  "issue.empty.none": "連携中のプロジェクトにはまだ課題がありません。",
  "issue.empty.projectsFailed": "プロジェクトを読み込めませんでした。",
  "issue.empty.retryProjects": "再試行",
  "issue.empty.pickProject": "プロジェクトを選択して課題を表示してください。",
  "issue.empty.noMatch": "検索条件に一致する課題がありません。",
  "issue.empty.unbound":
    "このリポジトリには課題トラッカーが接続されていません。[[設定 → 課題パネル]] で接続してください。",
  "issue.empty.credentialMissing":
    "このリポジトリの課題トラッカーのアクセストークンが見つかりません。[[設定 → 課題パネル]] で再入力してください。",
  "issue.empty.loadFailed":
    "トラッカーから課題を読み込めませんでした。接続を確認し、[[設定 → 課題パネル]] でトークンを確認してください。",
  "issue.hoursUnit": "時間",
  "issue.status.created": "作成済み",
  "issue.status.in_progress": "進行中",
  "issue.status.done": "完了",
  "issue.status.rejected": "却下",
  "issue.field.project": "プロジェクト",
  "issue.field.status": "ステータス",
  "issue.field.labels": "ラベル",
  "issue.field.assignee": "担当者",
  "issue.field.due": "期限",
  "issue.field.milestone": "マイルストーン",
  "issue.field.spend": "消費コスト",
  "issue.field.cost": "見積もりコスト",
  "issue.dueStart": "開始",
  "issue.dueEnd": "終了",
  "issue.dueInvalid": "開始日は終了日以前である必要があります。",
  "issue.noAssignee": "未割り当て",
  "issue.noMilestone": "マイルストーンなし",
  "issue.noProject": "プロジェクトなし",
  "issue.addLabel": "ラベルを追加",
  "issue.spendLockedHint": "進行中は編集可能",
  "issue.field.unsupportedHint": "このトラッカーでは非対応：{reason}",
  "issue.field.caveatHint": "ご注意：{reason}",
  "issue.field.caveatDestructive": "警告 — データが削除されます：{reason}",
  "issue.error.saveFailed": "この変更を保存できず、元に戻しました：{reason}",
  "issue.error.refreshFailed": "このイシューを更新できませんでした：{reason}",
  "issue.error.actionFailed": "この操作は完了しませんでした：{reason}",
  "issue.action.new": "新規…",
  "issue.action.reject": "却下",
  "issue.action.start": "開始",
  "issue.action.startNewBranch": "新しいブランチで開始",
  "issue.action.startJustGo": "そのまま開始",
  "issue.action.withdraw": "取り下げ",
  "issue.action.done": "完了",
  "issue.action.doneUpdateSpent": "消費コストを更新してクローズ",
  "issue.action.doneJustClose": "そのままクローズ",
  "issue.action.reopen": "再オープン",
  "issue.rejectedReason": "却下理由：{reason}",
  "issue.comments.title": "コメント",
  "issue.comments.empty": "まだコメントはありません。",
  "issue.comments.placeholder": "コメントを入力…",
  "issue.comments.send": "送信",
  "issue.composer.title": "新しいブランチで開始",
  "issue.composer.type": "種別",
  "issue.composer.desc": "簡単な説明",
  "issue.composer.preview": "ブランチ名",
  "issue.composer.confirm": "作成してチェックアウト",
  "issue.composer.invalid":
    "有効なブランチ名を生成するには説明を入力してください。",
  "issue.reject.title": "課題を却下",
  "issue.reject.prompt":
    "この課題を却下する理由を入力してください。課題に記録されます。",
  "issue.reject.placeholder": "理由…",
  "issue.reject.confirm": "却下",
  "issue.reject.required": "理由の入力が必要です。",
  "issue.new.title": "新しい課題",
  "issue.new.titleField": "タイトル",
  "issue.new.project": "プロジェクト",
  "issue.new.labels": "ラベル（カンマ区切り）",
  "issue.new.confirm": "作成",
  "integration.createMr": "マージリクエストを作成",
  "integration.createIssue": "課題を作成",
  "integration.noToken":
    "マージリクエストや課題を作成するには、Webhooks 設定で GitHub または GitLab のトークンを追加してください。",
  "integration.composeMr": "新しいマージリクエスト",
  "integration.composeIssue": "新しい課題",
  "integration.titleField": "タイトル",
  "integration.target": "プロバイダー",
  "integration.targetBranch": "対象ブランチ",
  "integration.creating": "作成中…",
  "integration.created": "作成しました：",
  "integration.authError":
    "認証に失敗しました — Webhooks 設定のトークンを確認してください。",
  "integration.failed":
    "リクエストを完了できませんでした。もう一度お試しください。",
  "common.browse": "参照…",
  "branchEdit.title": "ブランチを編集",
  "search.scopeLabel": "検索範囲",
  "graph.commitLabel": "コミット {sha} を選択またはドラッグ",
  "graph.commitHint":
    "クリックで選択・ブランチ/コミットへドラッグしてチェリーピックまたは並べ替え",
  "graph.mergeHint": "別のブランチの先頭にドラッグしてマージ",
  "graph.crownHint":
    "クリックで HEAD を選択・コミットへドラッグしてリセット（Shift = ハードリセット、Cmd/Ctrl = ソフトリセット）",
  "graph.crownLabel": "HEAD を選択または移動",
  "graph.newCommit": "新しいコミット",
  "menu.dismiss": "メニューを閉じる",
  "openCreate.title": "開くまたは作成",
  "openCreate.pathPlaceholder": "/path/to/project",
  "colorPicker.sv": "彩度と明度",
  "colorPicker.hue": "色相",
  "colorPicker.hex": "Hex",
  "clone.title": "リポジトリをクローン",
  "clone.projectPlaceholder": "my-project",
  "clone.locationPlaceholder": "/path/to/clone/into",
  "diff.close": "差分を閉じる",
  "diff.title": "ファイル差分",
  "branchesPanel.filter": "フィルター",
  "branchesPanel.localHint":
    "クリックで選択、ダブルクリックで {name} をチェックアウト",
  "branchesPanel.cannotDeleteCurrent": "現在のブランチは削除できません",
  "branchesPanel.delete": "削除",
  "branchesPanel.remoteHint":
    "ダブルクリックまたは右クリックで {name} をチェックアウト",
  "branchesPanel.remoteTag": "リモート",
  "branchesPanel.deleteTag": "タグを削除",
  "branchesPanel.newTagPlaceholder": "新しいタグ（HEAD 位置）",
  "branchesPanel.branchesHeading": "ブランチ",
  "branchesPanel.tagsHeading": "タグ",
  "themeStore.previewSubject": "コミット件名",
  "tutorial.hint.info": "「次へ」を押して続けます。",
  "tutorial.hint.busy": "しばらくお待ちください。ADGitter が準備しています…",
  "tutorial.welcome.title": "ADGitter へようこそ",
  "tutorial.welcome.body":
    "ADGitter は Git を、目で見て触れられるものに変えます。ドラッグだけでマージ、リベース、チェリーピック、リセットができるライブのコミットグラフです。この短いツアーでは使い捨ての練習用リポジトリを使うので、実際のプロジェクトには影響しません。",
  "tutorial.choose.title": "ツアーに参加しますか？",
  "tutorial.choose.body":
    "ガイド付きチュートリアルでは、練習用リポジトリで各ジェスチャーを学べます。所要時間は約 10 分です。スキップして ADGitter をそのまま使うこともできます。アカウントメニューからいつでもやり直せます。",
  "tutorial.createDemo.title": "練習用リポジトリを作成する",
  "tutorial.createDemo.body":
    "ADGitter は、アプリのデータフォルダー内に、専用のローカルリモートを備えた小さなデモ用リポジトリを作成します。お使いのリポジトリ、ネットワーク、アカウントには一切触れません。「デモを作成」を押して始めましょう。",
  "tutorial.createDemo.hint": "「デモを作成」を押して続けます。",
  "tutorial.createDemo.primary": "デモを作成",
  "tutorial.tourGraph.title": "グラフの読み方",
  "tutorial.tourGraph.body":
    "1 行が 1 つのコミットで、新しいものが一番上に表示されます。色分けされたレーンはブランチの分岐と合流を示し、履歴は路線図のように読めます。この練習用リポジトリには、すでに少し履歴があります。main にマージされた枝ブランチと、タグ付きのリリースです。",
  "tutorial.tourCommit.title": "コミット",
  "tutorial.tourCommit.body":
    "丸が 1 つのコミットで、これは「Write getting-started guide」です。2 本のレーンが 1 つのコミットに合流しているなら、それはマージコミットです。すぐ上の「Merge branch 'docs/intro'」を見てください。コミットをクリックすると選択され、詳細が開きます。後ほど、そこからドラッグしてマージ、リベース、チェリーピックを行います。",
  "tutorial.tourBranch.title": "ブランチチップ",
  "tutorial.tourBranch.body":
    "コミットの横にある色付きのチップは、そのコミットを指すブランチです。チップをクリックするとブランチを選択、ダブルクリックするとチェックアウト、現在のブランチにドラッグするとマージできます。ここでは main と docs/intro が 2 つのブランチで、小さなタグ v0.0.1 はマージコミット上のリリースを示します。",
  "tutorial.tourHead.title": "HEAD の王冠",
  "tutorial.tourHead.body":
    "王冠は HEAD、つまり作業中のコミットを示します。古いコミットにドラッグすると、ブランチをそのコミットにリセットします。まもなく試します。",
  "tutorial.tourHandle.title": "マージハンドル",
  "tutorial.tourHandle.body":
    "ブランチの先端にマウスを重ねると、上に小さな丸いハンドルが現れます。そのハンドルを別のブランチの先端にドラッグすると、2 つをマージできます。",
  "tutorial.firstCommit.title": "最初のコミットを作る",
  "tutorial.firstCommit.body":
    "ADGitter がデモにいくつか新しいファイルを作成しました。「変更されたファイル」パネルを開いてステージし、コミットメッセージを入力してコミットします。コミットはすぐにグラフに表示されます。",
  "tutorial.firstCommit.hint":
    "「変更されたファイル」パネルを開き、ファイルをステージしてコミットします。",
  "tutorial.seedHistory.title": "にぎやかな履歴",
  "tutorial.seedHistory.body":
    "より実践的に練習できるよう、ADGitter はコミットをさらに追加し、3 つのブランチ（feature/login、feature/theme、experiment）と 2 つのタグを作成しました。グラフを見渡してから「次へ」を押してください。",
  "tutorial.selectCommit.title": "コミットを選択する",
  "tutorial.selectCommit.body":
    "任意のコミットをクリックして選択します。コミットを選択すると詳細も開き、ほとんどのジェスチャーはここから始まります。",
  "tutorial.selectCommit.hint": "グラフ上のコミットを 1 つクリックします。",
  "tutorial.selectMany.title": "複数のコミットを選択する",
  "tutorial.selectMany.body":
    "グラフの空白部分でドラッグして 2 つ以上のコミットを四角で囲むか、Ctrl（Mac では ⌘）を押しながらコミットを追加でクリックします。複数選択したコミットは、まとめて移動やコピーができます。",
  "tutorial.selectMany.hint": "2 つ以上のコミットを範囲選択します。",
  "tutorial.mergeDrag.title": "ドラッグでマージする",
  "tutorial.mergeDrag.body":
    "feature/login の先端にマウスを重ねて丸いハンドルが現れたら、そのハンドルを main にドラッグします。確認メッセージで承認すると、ADGitter がそのブランチを main にマージします。",
  "tutorial.mergeDrag.hint":
    "feature/login の丸いハンドルを main にドラッグします。",
  "tutorial.branchSelect.title": "ブランチを選択する",
  "tutorial.branchSelect.body":
    "feature/theme のチップをクリックして、ブランチ全体を選択します。選択したブランチは 1 つのまとまりとして移動します。次のリベースに必要な操作です。",
  "tutorial.branchSelect.hint": "feature/theme のチップをクリックします。",
  "tutorial.rebase.title": "ブランチをリベースする",
  "tutorial.rebase.body":
    "選択した feature/theme ブランチを main にドラッグすると、そのコミットが main の最新の作業の上に再適用されます。履歴が書き換えられるため、ADGitter は最初に確認を求めます。",
  "tutorial.rebase.hint": "feature/theme を main のチップにドラッグします。",
  "tutorial.cherryPick.title": "コミットをチェリーピックする",
  "tutorial.cherryPick.body":
    "experiment ブランチの「Try faster render」コミットをクリックし、Alt（Mac では ⌥）を押しながら main のチップにドラッグします。そのコミットだけのコピーが main に追加されます。",
  "tutorial.cherryPick.hint":
    "Alt を押しながら「Try faster render」を main のチップにドラッグします。",
  "tutorial.undo.title": "直前の操作を元に戻す",
  "tutorial.undo.body":
    "気が変わりましたか？ツールバーの「元に戻す」を押すと、直前の操作（ここではチェリーピック）を取り消せます。やり直し（Redo）はないので、慎重に操作してください。",
  "tutorial.undo.hint": "ツールバーの「元に戻す」ボタンを押します。",
  "tutorial.reset.title": "HEAD の王冠でリセットする",
  "tutorial.reset.body":
    "HEAD の王冠を main 上の古いコミットにドラッグすると、main をそこまで戻せます。そのままドラッグすると mixed リセット、Shift を押しながらだと hard リセット（変更を破棄）、Ctrl/⌘ を押しながらだと soft リセットです。確認すると実行されます。",
  "tutorial.reset.hint": "王冠を main 上の古いコミットにドラッグします。",
  "tutorial.undoReset.title": "リセットを元に戻す",
  "tutorial.undoReset.body":
    "リセットは簡単に取り消せます。「元に戻す」を押すと、main がちょうど元の位置に戻ります。",
  "tutorial.undoReset.hint": "ツールバーの「元に戻す」ボタンを押します。",
  "tutorial.checkout.title": "ブランチをチェックアウトする",
  "tutorial.checkout.body":
    "feature/theme のチップをダブルクリックして、そのブランチに切り替えます。王冠が移動して、現在いるブランチを示します。",
  "tutorial.checkout.hint": "feature/theme のチップをダブルクリックします。",
  "tutorial.openDetail.title": "コミットの詳細を開く",
  "tutorial.openDetail.body":
    "「Add config」コミットをクリックします。詳細パネルには、そのコミットで変更されたすべてのファイルが表示されます。その中には、コミットすべきでなかったシークレットのファイルも含まれています。",
  "tutorial.openDetail.hint": "「Add config」コミットをクリックします。",
  "tutorial.purge.title": "履歴からファイルを削除する",
  "tutorial.purge.body":
    "secrets.env を履歴に残してはいけません。詳細パネルで secrets.env の「履歴からファイルを削除」を使います。ADGitter はこのコミットとそれ以降のすべてのコミットを書き換えるため、確認を求めます。",
  "tutorial.purge.hint": "secrets.env を履歴から削除します。",
  "tutorial.addFile.title": "過去のコミットにファイルを追加する",
  "tutorial.addFile.body":
    "安全なテンプレート secrets.example.env を作業フォルダーに用意しました。詳細パネルで「ファイルを追加」を選び、「Add config」コミットに追加して、履歴に無害なサンプルを残します。",
  "tutorial.addFile.hint":
    "secrets.example.env を「Add config」コミットに追加します。",
  "tutorial.reword.title": "コミットメッセージを修正する",
  "tutorial.reword.body":
    "「Add drak theme」コミットにはタイプミスがあります。選択して、詳細パネルで「コミットメッセージを編集」を選び、「Add dark theme」に変更します。",
  "tutorial.reword.hint": "「Add drak theme」のメッセージを編集します。",
  "tutorial.pushRejected.title": "作業をプッシュする",
  "tutorial.pushRejected.body":
    "「プッシュ」を押します。Git は拒否します。リモートにすでにある履歴を書き換えたため、ブランチがそれを土台にしていない状態になり、通常のプッシュは non-fast-forward として拒否されます。",
  "tutorial.pushRejected.hint": "ツールバーの「プッシュ」を押します。",
  "tutorial.forcePush.title": "強制プッシュ",
  "tutorial.forcePush.body":
    "履歴の書き換えが意図的な場合、強制プッシュはリモートのブランチを自分のブランチで置き換えます。「その他のプッシュオプション」メニューを開き、「強制プッシュ」を選んで確認します。共有ブランチでは慎重に使ってください。",
  "tutorial.forcePush.hint":
    "プッシュオプションを開き、「強制プッシュ」を選びます。",
  "tutorial.logIntro.title": "Log Anytime",
  "tutorial.logIntro.body":
    "Log Anytime は、ADGitter を開いている間、作業フォルダーのスナップショットを専用ブランチにそっと保存します。コミットしそびれた作業のためのセーフティネットです。次はこれをオンにします。",
  "tutorial.logOn.title": "Log Anytime をオンにする",
  "tutorial.logOn.body":
    "ツールバーの Log Anytime ボタンを押します。赤い点が点滅していれば記録中です。",
  "tutorial.logOn.hint": "Log Anytime ボタンを押します。",
  "tutorial.logSim.title": "スナップショットが現れます",
  "tutorial.logSim.body":
    "待ち時間を省くため、ADGitter がいくつかスナップショットをシミュレートしました。グラフの adgitter-log ブランチで確認できます。実際のスナップショットは、設定した間隔でここに追加されます。",
  "tutorial.logOff.title": "もう一度オフにする",
  "tutorial.logOff.body":
    "Log Anytime ボタンをもう一度押すと、記録が止まります。赤い点が消えます。",
  "tutorial.logOff.hint": "もう一度 Log Anytime ボタンを押します。",
  "tutorial.theme.title": "テーマを選ぶ",
  "tutorial.theme.body":
    "設定（歯車アイコン）を開いて「パーソナライズ」に移動し、気に入ったグラフテーマを適用して「OK」を押します。無料のテーマはオフラインでも使えます。",
  "tutorial.theme.hint": "設定を開き、別のテーマを適用して「OK」を押します。",
  "tutorial.issueBranch.title": "課題からブランチを作る",
  "tutorial.issueBranch.body":
    "「課題」パネルを開いて課題のブランチを作成します。ADGitter がブランチ名を付け、両者を関連付けます。このチュートリアルの課題はサンプルで、どこにも送信されません。",
  "tutorial.issueBranch.hint": "「課題」を開き、課題のブランチを作成します。",
  "tutorial.issueStatus.title": "課題を最新の状態に保つ",
  "tutorial.issueStatus.body":
    "作業中に、ADGitter を離れることなく課題のステータスを変更できます。たとえば「進行中」にします。",
  "tutorial.issueStatus.hint": "パネルで課題のステータスを変更します。",
  "tutorial.finish.title": "準備完了です",
  "tutorial.finish.body":
    "ツアーは以上です。これからデモ用リポジトリを削除します。続いて、ご自身のリポジトリを開く方法、リモートの設定方法、アクセストークンの作成方法を短いガイドで説明します。このチュートリアルはアカウントメニューからいつでもやり直せます。",
  "tutorial.finish.primary": "ADGitter を使い始める",
};
