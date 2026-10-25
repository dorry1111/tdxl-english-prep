/**
 * 全部中文文案常量（ARCHITECTURE 7.7：便于统一措辞，也便于将来做检查）。
 *
 * 规则：组件里不写中文字面量，一律从这里引用；
 * 新增错误码必须同时在本文件的 ERROR_MESSAGES 中补一条中文文案。
 */

export const APP = {
  name: '同等学力英语备考',
  shortName: '同等学力备考',
  slogan: '每天一点，考纲词汇过一遍',
} as const;

/** 布局与导航相关文案 */
export const LAYOUT = {
  skipToContent: '跳到主要内容',
  navTitle: '主导航',
  offline: '离线模式 · 数据已本地保存',
  closeNav: '关闭导航',
  expandSidebar: '展开侧边栏',
  collapseSidebar: '收起侧边栏',
} as const;

/** 通用按钮文案 */
export const ACTIONS = {
  confirm: '确定',
  cancel: '取消',
  save: '保存',
  retry: '重试',
  reload: '重新加载',
  close: '关闭',
  back: '返回',
  later: '稍后',
  updateNow: '立即更新',
} as const;

/** 空状态与占位文案 */
export const PLACEHOLDER = {
  building: '施工中',
  buildingHint: '这个页面会在后续批次实现，当前先保证路由与布局可用。',
} as const;

/** 各一级页面的占位说明（不放假数据，只说明将来放什么） */
export const PAGE_PLACEHOLDER = {
  homeTitle: '今日',
  homeDesc:
    '这里将显示：距考试倒计时、今日三项任务（新词 / 复习 / 真题）、连续打卡与掌握词数、未来 7 天到期量柱状图。',
  booksTitle: '选词',
  booksDesc: '这里将显示：词库卡片列表（启用开关、叠加顺序、已学进度）、生词本入口、单词统计入口。',
  examsTitle: '真题',
  examsDesc: '这里将显示：试卷库（草稿 / 待校对 / 可模拟）、粘贴切题入口、错题本与成绩曲线。',
  settingsTitle: '我的',
  settingsDesc: '这里将显示：学习与显示偏好、考试日期与词库启用、同步与备份、关于与安装说明。',
} as const;

/** 深色模式 / 主题 */
export const THEME = {
  title: '深色模式',
  auto: '跟随系统',
  light: '浅色',
  dark: '深色',
  ariaLabel: '切换深色模式',
} as const;

/** PWA 更新 */
export const UPDATE = {
  title: '有新版本可用',
  desc: '更新会重新加载应用，当前进度已保存。',
  offlineReady: '离线缓存已就绪，断网也能继续使用。',
  deferredHint: '检测到新版本，结束当前学习后提示你更新。',
} as const;

/** 数据库自检与降级 */
export const DB = {
  selfTestOk: '数据库自检通过：写入、读回、删除均正常。',
  selfTestFailed: '数据库自检失败，请检查浏览器是否处于隐私/无痕模式。',
  probeKey: '__probe__',
  probePrefix: 'dbprobe',
  openFailed: '无法打开本地数据库，学习进度可能无法保存。',
  privateModeWarning: '当前浏览器模式无法持久保存进度（可能处于无痕模式），请退出无痕模式或先导出备份。',
  quotaWarning: '存储空间不足，请导出备份后清理旧记录。',
} as const;

/** 发音设置（设置页「发音」卡片） */
export const SETTINGS_TTS = {
  title: '发音',
  accentAria: '口音选择',
  accentUk: '英式发音',
  accentUs: '美式发音',
  autoAria: '出卡自动发音',
  autoOn: '出卡自动读',
  autoOff: '手动点读',
  hint: '口音同时作用于出卡自动发音与卡片右上角发音按钮；iPhone 静音拨片打开时网页语音会无声。',
} as const;

/** 考试日期设置（设置页「考试日期」卡片） */
export const SETTINGS_EXAM = {
  title: '考试日期',
  ariaLabel: '选择考试日期',
  daysLeft: (days: number) => `距考试还有 ${days} 天`,
  invalidHint: '日期无效，未保存。',
  hint: '考试日期用于「学习计划」推算与倒计时展示；词库的启用与叠加顺序在「选词」页管理。',
} as const;

/** 关于（设置页「关于」卡片） */
export const SETTINGS_ABOUT = {
  title: '关于',
  versionLabel: '当前版本',
  pwaTitle: '手机 / 浏览器',
  pwaInstall: '在浏览器菜单选「安装应用」或「添加到主屏幕」，即可全屏离线使用。',
  desktopTitle: '电脑版',
  desktopInstall: '运行 TDXL-English-Prep 安装包安装；两端数据通过 WebDAV 同步保持一致。',
} as const;

/** 学习快捷键（设置页「学习快捷键」卡片：四档评级的键盘 / 手柄自定义） */
export const SETTINGS_HOTKEYS = {
  title: '学习快捷键',
  hint: '键盘在背单词页直接生效；手柄连接后按任意键即可识别（电脑版与浏览器均支持）。揭示默认空格 / 回车，手柄默认 Start。',
  keyboardColumn: '键盘',
  gamepadColumn: '手柄',
  captureKeyboard: '按键捕获',
  captureGamepad: '手柄捕获',
  capturingKeyboard: '请按下键盘按键…（Esc 取消）',
  capturingGamepad: '请按手柄任意按键…（10 秒内有效）',
  gamepadRevealRow: '揭示答案（手柄）',
  gamepadMissing: '未检测到手柄，请连接后重试。',
  conflict: (label: string) => `与「${label}」的键位冲突，未保存。`,
  reset: '恢复默认',
  defaultHint: (keyboard: string, gamepad: string) => `默认：键盘 ${keyboard} / 手柄 ${gamepad}`,
} as const;

/** 数据同步设置（设置页「数据同步」卡片，T18） */
export const SETTINGS_SYNC = {
  title: '数据同步',
  serverLabel: 'WebDAV 服务器地址',
  serverPlaceholder: 'http://192.168.31.239:5005/业务/tdxl-sync/',
  serverHint: '同步文件会存放在该目录下，按设备分文件写入。',
  userLabel: '账号',
  passwordLabel: '应用密码',
  passwordPlaceholderSaved: '已保存（留空表示不修改）',
  passwordPlaceholderEmpty: '未设置，必填后才能同步',
  proxyLabel: '浏览器跨域代理',
  proxyAria: '是否走同源代理',
  proxyOn: '走代理',
  proxyOff: '直连',
  proxyUrlLabel: '代理地址前缀',
  proxyUrlPlaceholder: '/dav/',
  enableLabel: '自动同步',
  enableAria: '是否启用自动同步',
  enableOn: '启用',
  enableOff: '停用',
  save: '保存配置',
  saving: '保存中…',
  saved: '同步配置已保存。',
  needServerUser: '启用同步前，请先填写服务器地址与账号。',
  needProxyUrl: '走代理时需要填写代理地址前缀。',
  saveFailed: '保存失败，请重试。',
  syncNow: '立即同步',
  syncing: '同步中…',
  syncDone: '同步完成。',
  settingsMissing: '设置尚未初始化，请重启应用。',
  lastNever: '尚未同步过',
  lastAt: (when: string) => `上次同步：${when}`,
  statLine: (up: number, down: number, conflicts: number) =>
    `上传 ${up} 条 · 下载 ${down} 条 · 解决冲突 ${conflicts} 次`,
  failed: (msg: string) => `同步失败（${msg}）`,
  hintStrategy: '同步采用「每设备独立文件 + 最后写入胜出」策略；真题做题记录暂不在同步范围。',
  hintProxy: '网页版（PWA）跨端口访问会被浏览器拦截，需走同源反代（NAS 已配好 /dav/）；电脑版选直连即可。',
  secretSaved: '密码已保存',
  secretNotSet: '未设置密码',
} as const;

/** AI 释义设置（设置页「AI 释义」卡片，供搜索弹窗调用大模型） */
export const SETTINGS_AI = {
  title: 'AI 释义',
  providerLabel: '大模型',
  providerAria: '选择大模型服务商',
  urlLabel: 'API 地址（OpenAI 兼容根路径）',
  modelLabel: '模型名（豆包可填接入点 ep-xxx）',
  keyLabel: 'API Key',
  keyPlaceholderSaved: '已保存（留空表示不修改）',
  keyPlaceholderEmpty: '未设置，必填后才能使用 AI 释义',
  save: '保存配置',
  saving: '保存中…',
  saved: 'AI 释义配置已保存。',
  needUrlModel: '请先填写 API 地址与模型名。',
  saveFailed: '保存失败，请重试。',
  hintLocal: 'API Key 只保存在本机，不参与云同步；换设备需要重新填写。',
  hintProxy: '释义由所配大模型生成，仅供学习参考；网页版直连模型接口可能被浏览器跨域拦截，电脑版无此限制。',
} as const;

/** 错误兜底页 */
export const ERROR_PAGE = {
  title: '出错了',
  desc: '页面遇到了未预期的问题，你的学习记录已保存在本机。',
  devDetailTitle: '错误详情（仅开发模式显示）',
} as const;

/** 加载态 */
export const LOADING = {
  app: '正在加载…',
  page: '页面加载中…',
  lazyFailed: '页面资源加载失败，请检查网络后重试。',
} as const;

/** 学习会话页（P02，T09） */
export const STUDY = {
  showAnswer: '显示答案',
  exit: '退出',
  exitConfirmTitle: '退出学习？',
  exitConfirmDesc: '当前进度已保存，确定退出？',
  exitConfirm: '退出',
  backLabel: '上一个',
  bingDict: '必应词典',
  rating1: '不认识',  rating2: '模糊',
  rating3: '认识',
  rating4: '熟识',
  ratingGroupLabel: '四档评分',
  kindNew: '新词',
  kindReview: '复习',
  kindRetry: '重现',
  accentUk: '英',
  accentUs: '美',
  speakLabel: '发音',
  examplesTitle: '例句',
  mnemonicTitle: '助记',
  rootsTitle: '词根词缀',
  examSensesTitle: '考纲义项',
  confusablesTitle: '易混词',
  inflectionsTitle: '词形变化',
  inflPlural: '复数',
  inflThird: '三单',
  inflPast: '过去式',
  inflPastParticiple: '过去分词',
  inflPresentParticiple: '现在分词',
  inflIrregular: '不规则',
  revealHint: '点击卡片或按空格键显示答案',
  /** 双栏详情面板：未揭示时遮住释义/例句/笔记，只留词头与音标 */
  detailHiddenHint: '释义与笔记将在显示答案后出现',
  detailPanelTitle: '词条详情',
  cardFrontLabel: '单词卡片',
  cardAnswerLabel: '单词卡片（答案）',
} as const;

/**
 * 备注与高亮（学习页批次）。
 * 覆盖详情面板的备注框 / 收藏，以及卡片滑动高亮的浮动色板。
 */
export const NOTES = {
  star: '收藏',
  starred: '已收藏',
  notesTitle: '我的笔记',
  noteLabel: '备注',
  placeholderNote: '写下你的备注…',
  saved: '笔记已保存',
  noteDeleted: '笔记已删除',
  saveFailed: '保存失败，请重试。',
  paletteLabel: '选择高亮颜色',
  deleteHighlightLabel: '删除高亮',
  highlightFailed: '高亮保存失败，请重试。',
} as const;

/** 高亮色板单色按钮的无障碍名称 */
export function highlightColorLabel(color: number): string {
  return `高亮颜色 ${color}`;
}

/** 会话结算页（P03，T10） */
export const SUMMARY = {
  title: '本次学习',
  answered: '本次词数',
  newCount: '新词',
  reviewCount: '复习',
  accuracy: '正确率',
  ratingDist: '四档分布',
  duration: '用时',
  unstableTitle: '不稳定词',
  unstableDesc: '建议明天优先重背这些词。',
  again: '再学一组',
  backHome: '返回首页',
  noDataTitle: '没有可显示的结算数据',
  noDataDesc: '完成一次学习后，这里会显示本次的词数、正确率与用时。',
  unitWord: '词',
} as const;

/** 今日首页（P01，T10） */
export const HOME = {
  title: '今日',
  dueToday: '待复习',
  newRemaining: '今日新词剩余',
  totalWords: '词库总词数',
  start: '开始背单词',
  restart: '重新开始',
  continueActive: '继续背单词',
  allDone: '今日已达标',
  todayDone: '今日已完成',
  resumeTitle: '有未完成的学习',
  resumeDesc: '上次学习尚未结束，可以选择继续或重新开始。',
} as const;

/** 带数字的首页文案（模板集中在这里，组件里不写中文字面量） */
export function homeContinueLabel(answered: number): string {
  return `继续上次（已答 ${answered} 词）`;
}

/** 结算页不稳定词计数文案 */
export function summaryUnstableLine(count: number): string {
  return `${count} 个词今日达重现上限仍答错`;
}

/**
 * 错误码 → 中文文案。
 *
 * 这张表同时是错误码的「唯一真源」：`ErrorCode` 联合类型由 `keyof typeof ERROR_MESSAGES` 推导，
 * 因此新增一个 key 就等于新增一个合法错误码，不会出现「有码无文案」的情况。
 */
export const ERROR_MESSAGES = {
  INVALID_INPUT: '输入内容不合法，请检查后重试。',
  NOT_FOUND: '没有找到对应的内容。',
  UNKNOWN: '操作失败，请稍后重试。',

  DB_OPEN_FAILED: '本地数据库打开失败，请重试或改用普通浏览模式。',
  DB_WRITE_FAILED: '保存失败，请重试。',
  DB_QUOTA_EXCEEDED: '本地存储空间不足，请导出备份后清理旧记录。',
  DB_UNAVAILABLE: '当前环境不支持本地数据库，无法保存进度。',
  DB_PRIVATE_MODE: '当前处于无痕模式，进度无法持久保存。',

  WORD_NOT_FOUND: '没有找到这个单词。',
  WORD_DUPLICATE: '词库中已存在相同的单词。',
  BOOK_NOT_FOUND: '没有找到这个词库。',
  BOOK_EMPTY: '这个词库里还没有单词。',

  SESSION_NOT_FOUND: '没有找到学习会话。',
  SESSION_STATE_INVALID: '学习状态异常，请重新进入会话。',
  QUEUE_EMPTY: '当前队列已空。',

  EXAM_NOT_FOUND: '没有找到这份试卷。',
  EXAM_SCORE_MISMATCH: '各题型分值合计与试卷总分不一致。',
  EXAM_PARSE_FAILED: '自动切题失败，请改用校对或手动录入。',
  EXAM_NOT_VERIFIED: '请先完成切题校对，再开始模拟。',
  EXAM_JSON_INVALID: '试卷 JSON 格式不符合要求。',

  ATTEMPT_NOT_FOUND: '没有找到这次答题记录。',
  ATTEMPT_ALREADY_SUBMITTED: '这次答题已经交卷了。',

  IMPORT_FILE_INVALID: '文件无法读取，请确认格式与编码。',
  IMPORT_FORMAT_UNSUPPORTED: '不支持这种文件格式。',
  IMPORT_PARTIAL_FAILED: '部分内容导入失败，请查看错误清单。',

  BACKUP_INVALID: '备份文件格式不正确。',
  BACKUP_VERSION_UNSUPPORTED: '备份文件版本高于当前应用，请先升级应用。',

  SYNC_DISABLED: '同步未启用。',
  SYNC_NETWORK: '网络不可用或请求超时。',
  SYNC_AUTH: '账号或应用密码有误。',
  SYNC_PROXY: '代理服务异常，请检查代理地址或跨域设置。',
  SYNC_CONFLICT: '远端内容已被其他设备修改，已尝试合并，请再次同步。',
  SYNC_PARSE: '远端数据格式不符合预期，已跳过该文件。',

  TTS_UNAVAILABLE: '当前设备不支持发音。',
  STORAGE_LIMITED: '浏览器限制了本地存储，进度可能无法长期保存。',
} as const;

/** 统一取值：错误码对应文案（未知码回落通用文案） */
export function messageOfCode(code: string): string {
  const table: Record<string, string> = ERROR_MESSAGES;
  return table[code] ?? ERROR_MESSAGES.UNKNOWN;
}

/**
 * 真题域文案（T13 试卷库 / 录入 / 校对，T14 组卷 / 答题 / 答题卡 / 倒计时，
 * T15 成绩单 / 解析回看 / 错题本）。组件里不写中文字面量，一律从这里取。
 */
export const EXAMS = {
  // ---------- 试卷库（P10） ----------
  importBuiltin: '导入内置真题',
  importing: '正在导入内置真题…',
  importDone: (imported: number, failed: number) =>
    `已导入 ${imported} 套真题${failed > 0 ? `，${failed} 套失败已跳过` : '。'}`,
  importFailed: '内置真题导入失败，请确认网络可用后重试。',
  emptyTitle: '还没有试卷',
  emptyDesc: '先导入一套内置真题，或在下方「新建录入」粘贴一份试卷。',
  newPaper: '新建录入',
  wrongBookEntry: '错题本',
  statsEntry: '成绩曲线',
  statsExamsDesc: '这里将用折线图展示历次模拟成绩的变化趋势（批次 4）。',
  colTitle: '标题',
  colSections: '题型',
  colQuestions: '题数',
  colScore: '总分',
  colActions: '操作',
  startMock: '开始模拟',
  editPaper: '编辑',
  reviewParse: '校对',
  deletePaper: '删除',
  deleteConfirmTitle: '删除这份试卷？',
  deleteConfirmDesc: '删除后试卷不再显示，历史作答记录保留。',
  deleted: '试卷已删除。',
  paperOfSections: (n: number) => `${n} 种题型`,
  questionCountUnit: (n: number) => `${n} 题`,
  scoreOf: (n: number) => `${n} 分`,

  // ---------- 录入页（P11） ----------
  editTitleNew: '新建试卷录入',
  tabPaste: '粘贴切题',
  tabManual: '手动逐题',
  tabJson: '导入 JSON',
  pasteLabel: '把整卷纯文本粘贴到下面（可含区段标题、题目、选项、答案与解析）',
  pastePlaceholder: '在此粘贴试卷原文…',
  autoSplit: '自动切题',
  charCount: (n: number) => `${n} 字`,
  parseFailedTitle: '自动切题发现问题，请修正后再试：',
  manualFormTitle: '逐题录入',
  manualSeqLabel: '序号',
  manualSectionLabel: '题型',
  manualStemLabel: '题干',
  manualStemPlaceholder: '输入题干…',
  manualOptionsLabel: '选项（客观题）',
  manualOptionLabel: (key: string) => `选项 ${key}`,
  manualAnswerLabel: '正确答案',
  manualReferenceLabel: '参考答案 / 范文',
  manualExplanationLabel: '解析',
  manualScoreLabel: '分值',
  manualPassageLabel: '原文（阅读 / 完形 / 短文完成可填）',
  manualPassagePlaceholder: '该题对应的文章原文，可留空…',
  saveAndNext: '保存并下一题',
  manualSavedList: '已录入题目',
  manualEmpty: '还没有录入题目。',
  manualRemove: '删除本题',
  manualFinish: '完成并保存试卷',
  manualPaperTitleLabel: '试卷标题',
  manualPaperTitlePlaceholder: '例如：2024 年模拟卷（自录）',
  manualDraftRestored: '已恢复上次未完成的录入草稿。',
  manualSaved: (n: number) => `已录入 ${n} 题（草稿已自动保存）`,
  manualSavedDone: '试卷已保存，可直接开始模拟。',
  manualNeedTitle: '请先填写试卷标题。',
  manualNeedStem: '请先填写题干。',
  manualAnswerInvalid: '答案必须在选项集合内。',
  manualDraftCleared: '草稿已清空。',
  manualClearDraft: '清空草稿',
  jsonPickFile: '选择试卷 JSON 文件',
  jsonIssuesTitle: '校验未通过（未写入任何数据）：',
  jsonImportOk: '试卷导入成功，可直接开始模拟。',
  jsonReading: '正在读取文件…',

  // ---------- 校对页（P12） ----------
  reviewTitle: '切题校对',
  reviewPaneOriginal: '原文',
  reviewPaneTree: '结构',
  reviewUnresolvedTitle: (n: number) => `未识别内容（${n} 行）`,
  reviewNoUnresolved: '没有未识别内容。',
  reviewWarningTitle: '切题告警',
  reviewConfirmSave: '确认并保存试卷',
  reviewSaved: '试卷已确认保存，可以开始模拟。',
  reviewRawMissing: '找不到本次切题的原文（可能已刷新页面）。结构树仍可校对与保存。',
  reviewLineOf: (n: number) => `第 ${n} 行`,
  reviewUnresolvedReason: '原因',
  reviewMoveTo: '移动到区段…',
  parseTreeSectionMeta: (questions: number, passages: number) =>
    `${questions} 题 · ${passages} 篇文章`,
  parseTreeQuestionLabel: (seq: number) => `定位第 ${seq} 题（可拖动调整区段）`,

  // ---------- 组卷（P13） ----------
  startTitle: '开始模拟',
  modeFull: '整卷模拟',
  modeSection: '专项练习',
  fullDesc: (q: number, score: number, minutes: number) =>
    `共 ${q} 题 ${score} 分，限时 ${minutes} 分钟。`,
  sectionTypeLabel: '选择题型',
  sectionCountLabel: '题量',
  sectionTimedLabel: '限时',
  sectionTimedOn: '限时',
  sectionTimedOff: '不限时',
  drillTimeOf: (minutes: number) => `约 ${minutes} 分钟`,
  countAll: '全部',
  beginAttempt: '开始作答',
  startBlocked: ERROR_MESSAGES.EXAM_NOT_VERIFIED,
  startConfirmTitle: '开始前请确认',
  startConfirmUnverified: '这份试卷还没完成校对，题目或答案可能不完整。',
  startConfirmMissing: (n: number) =>
    `这份试卷有 ${n} 道客观题缺答案，这些题不参与判分，成绩仅供参考。`,
  startConfirmAnyway: '仍然开始',
  poolTooSmall: (pool: number) => `该题型只有 ${pool} 题，将全部抽出。`,

  // ---------- 答题页（P14） ----------
  examPassageTitle: '原文',
  examPassageBilingual: '双语',
  examBlankBadge: (n: number) => `第 ${n} 空`,
  dialogueScriptTitle: '对话原文',
  examOptionGroup: (seq: number) => `第 ${seq} 题选项`,
  examSubjectiveInputLabel: (seq: number) => `第 ${seq} 题作答输入框`,
  examSubjectiveMaxOf: (name: string, max: number) => `${name}满分 ${max} 分`,
  reviewExplanationTitle: '解析',
  aiExplainButton: 'AI 讲解',
  aiExplainDialogTitle: 'AI 讲解',
  aiDiagnoseButton: 'AI 诊断',
  aiDiagnoseDialogTitle: 'AI 错因诊断',
  aiAdviseButton: 'AI 评估',
  aiAdviseDialogTitle: 'AI 计划评估',
  aiAdoptButton: '采纳建议',
  aiAdoptedToast: '已更新每日新词量。',
  aiHistoryTitle: '历史报告',
  aiNotConfigured: '请先在「我的 → 大模型」里配置并保存 API Key。',
  aiDesktopOnly: 'AI 功能仅在电脑桌面版可用。',
  attemptSubmit: '交卷',
  attemptSheet: '答题卡',
  attemptSubmitConfirmTitle: '确认交卷？',
  attemptSubmitConfirmDesc: '交卷后客观题自动判分，主观题可在成绩单自评。',
  attemptSubmitted: '已交卷。',
  attemptAutoSubmitted: '时间到，已自动交卷。',
  attemptPausedTitle: '已暂停',
  attemptPausedDesc: '倒计时已暂停，题目已遮挡。点击继续恢复作答。',
  attemptResume: '继续作答',
  attemptPause: '暂停',
  attemptFlagged: '标记',
  attemptFlaggedOn: '已标记',
  attemptPrev: '上一题',
  attemptNext: '下一题',
  attemptSaveFailed: '答案暂存失败，请重试。',
  attemptNotFoundDesc: '答题记录不存在或已交卷。',
  attemptRestoreFailed: '无法恢复这次作答。',
  attemptSubjectiveEntry: '主观题作答页',
  attemptSubjectiveTitle: '主观题作答',
  attemptSubjectiveSave: '保存本题',
  attemptSubjectiveSaved: '本题已保存。',
  attemptSubjectivePlaceholder: '在此输入你的答案…',
  attemptWordLimitHint: (max: number) => `建议不超过 ${max} 词`,

  // ---------- 答题卡（P14） ----------
  countdownLabel: '剩余时间',
  sheetTitle: '答题卡',
  sheetLegendUnanswered: '未答',
  sheetLegendAnswered: '已答',
  sheetLegendFlagged: '已标记',
  sheetFlaggedOnly: '只看标记',
  sheetFlaggedEmpty: '该区段暂无标记题。',
  sheetSubjectiveTranslation: '译',
  sheetSubjectiveWriting: '写',
  sheetJumpTo: (seq: number) => `跳到第 ${seq} 题`,
  sheetGroupLabel: (roman: string, name: string, count: number) => `${roman} ${name}（${count} 题）`,
  sheetAnsweredCount: (answered: number, total: number) => `已答 ${answered}/${total}`,

  // ---------- 成绩单（P17） ----------
  resultTitle: '成绩单',
  resultObjective: '客观题',
  resultSubjective: '主观题（自评）',
  resultTotal: '总分',
  resultDuration: '用时',
  resultAccuracy: '客观正确率',
  resultSectionBreakdown: '分题型得分',
  resultSectionScore: (name: string, earned: number, full: number, correct: number, total: number) =>
    `${name}：${earned}/${full} 分（答对 ${correct}/${total}）`,
  resultSelfEvalTitle: '主观题自评',
  resultSelfEvalDesc: '对照参考答案给自己打分，打分会计入总分。',
  resultSelfEvalOf: (name: string, max: number) => `${name}（0 ~ ${max} 分）`,
  resultSelfEvalSave: '提交自评',
  resultSelfEvalSaved: '自评已计入总分。',
  resultSelfScore: (n: number) => `${n} 分`,
  resultViewReview: '查看解析',
  resultBackToExams: '返回试卷库',
  resultModeFull: '整卷模拟',
  resultModeSection: '专项练习',
  resultCorrectUnit: (correct: number, answered: number) => `${correct}/${answered}`,
  resultPendingAnswers: (n: number) =>
    `本卷有 ${n} 道客观题缺答案（回忆版源文本未提供），已从客观满分中剔除，作答不判分、不计错题。`,

  // ---------- 解析回看（P18） ----------
  reviewExamTitle: '解析回看',
  reviewMyAnswer: '我的答案',
  reviewCorrectAnswer: '正确答案',
  reviewNoAnswer: '未作答',
  reviewCorrect: '答对',
  reviewWrong: '答错',
  reviewSubjective: '主观题',
  reviewAnswerPending: '答案待补',
  reviewReference: '参考答案',
  reviewExplanationEmpty: '这道题暂无解析。',
  reviewAddToNotebook: '加入生词本',
  reviewWordAdded: (word: string) => `「${word}」已加入生词本。`,
  reviewWordInvalid: '请选中一个英文单词。',
  reviewPickWordHint: '划选文字可高亮、写笔记；选中单词可加入生词本。',

  // ---------- 真题划词高亮（P3） ----------
  examHighlightBarLabel: '划词操作',
  examHighlightAddWord: '生词本',
  examHighlightNote: '笔记',
  examHighlightDelete: '删除高亮',
  examHighlightNoteTitle: '划词笔记',
  examHighlightNoteSave: '保存',
  examHighlightNoteCancel: '取消',
  examHighlightNotePlaceholder: '输入笔记内容（留空保存即清除笔记）…',
  examHighlightSaved: '已保存。',
  examHighlightAddWordFailed: '加入生词本失败，请重试。',

  // ---------- 错题本（P20） ----------
  wrongTitle: '错题本',
  wrongEmpty: '没有待复习的错题，保持下去！',
  wrongFilterSection: '题型',
  wrongFilterCount: '错误次数',
  wrongCountAll: '全部',
  wrongCountGte: (n: number) => `≥ ${n} 次`,
  wrongWrongTimes: (n: number) => `错 ${n} 次`,
  wrongRedo: '重做',
  wrongRedoBatch: '批量重做',
  wrongResolvedMark: '已掌握',
  wrongResolvedDone: '已移出错题本。',
  wrongLastAt: '最近答错',
  wrongRedoTip: '重做答对后会自动移出错题本。',

  // ---------- 做题记录（一级导航） ----------
  recordsTitle: '做题记录',
  recordsEmptyTitle: '还没有做题记录',
  recordsEmptyDesc: '去真题里选一套卷开始模拟，交卷后这次作答就会出现在这里。',
  recordsToExams: '去真题',
  recordsStatAttempts: '累计套数',
  recordsStatAvg: '平均分',
  recordsStatDuration: '累计用时',
  recordsStatRecent: '近 7 天',
  recordsUnit: (n: number) => `${n} 次`,
  recordsViewGrouped: '按试卷分组',
  recordsViewTimeline: '按时间平铺',
  recordsBestOf: (score: number) => `最高 ${score} 分`,
  recordsLastAt: (when: string) => `最近 ${when}`,
  recordsInProgress: '进行中',
  recordsSubmitted: '已交卷',
  recordsResume: '继续答题',
  recordsDurationOf: (text: string) => `用时 ${text}`,
  recordsObjectiveOf: (score: number) => `客观 ${score} 分`,
  recordsTotalOf: (score: number) => `总分 ${score} 分`,
  recordsViewResult: '查看成绩',
  recordsViewReview: '查看解析',
  recordsDelete: '删除',
  recordsDeleteConfirmTitle: '删除这条记录？',
  recordsDeleteConfirmDesc: '删除后这次作答不再出现在做题记录里，试卷与错题本不受影响。',
  recordsDeleted: '记录已删除。',
  recordsResumeFailed: '无法继续这次作答（可能已交卷，或试卷已被删除）。',
  recordsSummaryStale: '有些记录的试卷已被删除，标题显示为「已删除的试卷」。',
} as const;

/** 学习计划页（P04） */
export const PLAN = {
  title: '学习计划',
  countdownTitle: '考试倒计时',
  examDateLabel: '考试日期',
  daysLeftLabel: '距考试还有',
  daysUnit: '天',
  planTitle: '学习推算',
  totalLabel: '词库总词数',
  learnedLabel: '已学词数',
  remainingLabel: '剩余词数',
  dailyNewLabel: '每日建议新词',
  wordsPerDayUnit: '词 / 天',
  finishDateLabel: '预计学完',
  capHint: (cap: number) => `每日建议上限 ${cap} 词，避免最后几天压力过大。`,
  limitTitle: '每日新词量',
  limitAria: '每日新词量',
  modeAuto: '自动推算',
  modeManual: '按新词数',
  modeQuota: '按总学习量',
  quotaAria: '每日学习量',
  quotaHint: '每日学习量 = 待复习词 + 新学词，复习优先占满，余量给新词。',
  autoHint: (n: number) => `按剩余词数与考试日期自动推算，当前 ${n} 词 / 天。`,
  manualHint: (n: number) => `固定每天学 ${n} 个新词（范围 1~200），随时可调。`,
  missDeadlineText: '按当前进度，预计学完日期晚于考试日，建议提高每日新词量或只背高频词。',
  allLearnedText: '当前词库已全部学完，接下来的重点是复习与真题。',
  reviewTitle: '复习压力',
  dueTodayLabel: '当前待复习',
  dueTomorrowLabel: '明日新增',
  dueWeekLabel: '未来 7 天到期',
  dueInBookLabel: '当前词库待复习',
  pressureNone: '无压力',
  pressureLight: '有积压',
  pressureHeavy: '压力偏重',
  goStudy: '去背单词',
  footerHint: '考试日期可在「我的 - 设置」里调整；每日新词量与每日总学习量在本页设置。',
} as const;

/** 单词统计页（P06） */
export const STATS_VOCAB = {
  title: '单词统计',
  todayTitle: '今日学习',
  learnedToday: '今日新学',
  reviewedToday: '今日复习',
  answersToday: '答题次数',
  durationLine: (text: string) => `今日学习时长 ${text}`,
  progressTitle: '累计进度',
  streakLabel: '连续打卡',
  streakUnit: '天',
  dueLabel: '待复习',
  masteredLabel: '已掌握',
  masteredHint: (level: number) => `熟练度达到 ${level} 级（间隔 ≥ 30 天）记为已掌握。`,
  forecastTitle: '未来 7 天到期',
  forecastToday: '今天',
  forecastEmpty: '未来 7 天没有到期复习。',
  forecastAria: (counts: readonly number[]) => `未来 7 天到期复习量：${counts.join('、')}`,
  emptyTitle: '还没有学习记录',
  emptyDesc: '开始背单词后，这里会显示今日进度、连续打卡与未来复习量。',
} as const;

/** 统计总览页 /stats（词汇量 / 时长 / 记忆度 / 遗忘曲线 / 学习情况） */
export const STATS_DASH = {
  title: '统计',
  totalLearned: '总词汇量',
  totalDuration: '总学习时间',
  memoryTitle: '记忆度',
  memoryRemembered: '记忆',
  memoryFuzzy: '模糊',
  memoryForgotten: '陌生',
  /** 无人学习过（三档总数 0）时的占位 */
  memoryEmpty: '—',
  memoryHint: '按最近一次评分分档：认识 / 熟识记为记忆，模糊记为模糊，不认识记为陌生。',
  memoryPercent: (percent: number) => `${percent}%`,
  curveTitle: '艾宾浩斯遗忘曲线',
  curveDesc: '保持率 = 当日学习过的词中，现在仍记得（认识 / 熟识）的占比。',
  curveEmptyTitle: '暂无足够数据',
  curveEmptyDesc: '连续学习两天以上，这里会显示每日词汇保持率的变化。',
  curveAria: (values: readonly string[]) => `每日词汇保持率：${values.join('、')}`,
  studyAria: (values: readonly string[]) => `每日新学 / 复习：${values.join('；')}`,
  studyTitle: '学习情况',
  studyNew: '新学',
  studyReview: '复习',
  studyEmptyTitle: '暂无学习记录',
  studyEmptyDesc: '开始背单词后，这里会显示每日新学与复习的柱状图。',
  todayDurationLine: (text: string) => `今日学习时长 ${text}`,
  rangeAria: '时间范围',
  range7: '近 7 天',
  range30: '近 30 天',
  range90: '近 90 天',
} as const;

/** 词库管理页（P05） */
export const BOOKS = {
  modeTitle: '学习范围',
  modeSingleDesc: '单书模式：只背当前选中的词库。',
  modeStackDesc: '叠加模式：按顺序从多个词库取词，重复词自动去重。',
  modeSwitchToSingle: '切到单书',
  modeSwitchToStack: '切到叠加',
  sourceBuiltin: '内置',
  sourceNotebook: '生词本',
  sourceImported: '已导入',
  totalLabel: '共',
  learnedLabel: '已学',
  dueLabel: '待复习',
  progressLabel: (percent: number) => `已学 ${percent}%`,
  setCurrent: '设为当前',
  currentBook: '当前学习',
  activeTag: '学习中',
  startLearning: '开始学习',
  addFive: '+5 新词',
  addFiveHint: '进入学习会话后才能追加新词。',
  addedNewWords: (n: number) => `已加入 ${n} 个新词。`,
  noMoreNewWords: '当前词库没有更多新词了。',
  importEntry: '导入自定义词库',
  importEntryDesc: '支持 TXT / CSV 粘贴导入（页面在后续批次开放）。',
  emptyTitle: '没有可用词库',
  emptyDesc: '初始化完成后这里会显示内置词库与生词本。',
  footerHint: '切换词库只影响新词取词，已学的复习计划不受影响。',
} as const;
