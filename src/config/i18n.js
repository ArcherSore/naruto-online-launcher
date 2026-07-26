/**
 * Lightweight dependency-free internationalization.
 * Simplified Chinese is the default and fallback language. The setup window
 * keeps an isolated dictionary, so its locale set is protected by tests.
 */

'use strict';

const DEFAULT_LANGUAGE = 'zh-CN';
const SUPPORTED = ['zh-CN', 'en', 'de', 'es', 'pl', 'fr'];

const DICTIONARY = {
  'zh-CN': {
    'setup.title': '欢迎使用 Naruto Online 启动器',
    'setup.subtitle': '约 30 秒完成首次设置',
    'setup.language.label': '界面语言',
    'setup.mode.title': '性能模式',
    'setup.mode.default.body':
      '推荐所有设备使用：启用经过验证的安全优化，不降低 Flash 画质。',
    'setup.mode.lowpc.body':
      '仅适合旧 GPU 或少于 4GB RAM 的设备：降低 Flash 画质以提高 FPS，现代设备不建议启用。',
    'setup.save': '保存并进入启动器',
    'mode.default': '默认优化',
    'mode.lowpc': '低配模式',
    'common.ram': 'RAM',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.play': '打开',
    'common.edit': '编辑',
    'common.delete': '删除',
    'common.settings': '设置',
    'profile.name': '名称',
    'profile.new': '新建账号',
    'profile.empty': '还没有 Profile',
    'profile.empty.hint': '点击“新建账号”创建第一个 Profile。',
    'nav.accounts': '账号',
    'nav.settings': '设置',
    'topbar.new': '新建账号',
    'topbar.last_profile': '重新打开上次 Profile',
    'topbar.view_grid': '网格视图',
    'topbar.view_list': '列表视图',
    'search.placeholder': '按名称搜索 Profile…',
    'search.no_results': '没有匹配结果：',
    'card.play': '打开',
    'card.edit': '编辑',
    'card.delete': '删除',
    'card.duplicate': '复制',
    'card.favorite': '收藏',
    'card.unfavorite': '取消收藏',
    'card.open': '运行中',
    'card.status.idle': '就绪',
    'card.status.loading': '加载中',
    'card.status.success': '已登录',
    'card.status.error': '失败',
    'modal.edit_title': '编辑账号',
    'modal.new_title': '新建账号',
    'modal.notes': '备注',
    'modal.notes_optional': '（可选）',
    'modal.notes_placeholder': '例如：主账号、活动账号',
    'modal.cancel': '取消',
    'modal.save': '保存',
    'toast.profile_deleted': 'Profile 已删除',
    'toast.name_required': '请输入名称',
    'toast.exported': '已导出',
    'toast.imported': '已导入',
    'toast.perfis': '个 Profile',
    'toast.duplicated': 'Profile 已复制',
    'toast.favorited': '已收藏 Profile',
    'toast.unfavorited': '已取消收藏',
    'sort.name': '名称（A–Z）',
    'sort.last_used': '最近使用',
    'sort.launch_count': '使用次数',
    'sort.play_time': '游戏时长',
    'sort.created': '创建时间',
    'settings.general': '常规',
    'settings.language': '界面语言',
    'settings.language_desc': '设置启动器自有界面的显示语言',
    'settings.performance': '性能模式',
    'settings.performance_desc_default': '默认：启用安全优化',
    'settings.performance_desc_lowpc': '低配：降低 Flash 画质以提高 FPS',
    'settings.preferences': '偏好',
    delete_confirm: '删除这个 Profile 及其本地数据吗？'
  },

  en: {
    'setup.title': 'Welcome to Naruto Online Launcher',
    'setup.subtitle': 'Set up your experience in 30 seconds',
    'setup.language.label': 'Language',
    'setup.mode.title': 'Performance Mode',
    'setup.mode.default.body':
      'Recommended for everyone — maximum safe optimization. Always beneficial.',
    'setup.mode.lowpc.body':
      'Only for low-end PCs (old GPU or less than 4GB RAM). Reduces Flash visual quality to gain FPS. May be harmful on modern PCs.',
    'setup.save': 'Start playing',
    'mode.default': 'Optimized Default',
    'mode.lowpc': 'Low-end PC Mode',
    'common.ram': 'RAM',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.play': 'Play',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.settings': 'Settings',
    'profile.name': 'Name',
    'profile.new': 'New account',
    'profile.empty': 'No accounts registered',
    'profile.empty.hint': 'Click "New account" to create your first profile.',
    // v4.6: Launcher UI strings (en)
    'nav.accounts': 'Accounts',
    'nav.settings': 'Settings',
    'topbar.new': 'New account',
    'topbar.last_profile': 'Relaunch last profile',
    'topbar.view_grid': 'Grid view',
    'topbar.view_list': 'List view',
    'search.placeholder': 'Search profile by name...',
    'search.no_results': 'No results for',
    'card.play': 'Play',
    'card.edit': 'Edit',
    'card.delete': 'Delete',
    'card.duplicate': 'Duplicate',
    'card.favorite': 'Favorite',
    'card.unfavorite': 'Unfavorite',
    'card.open': 'open',
    'card.status.idle': 'ready',
    'card.status.loading': 'filling',
    'card.status.success': 'logged in',
    'card.status.error': 'failed',
    'modal.edit_title': 'Edit account',
    'modal.new_title': 'New account',
    'modal.notes': 'Notes',
    'modal.notes_optional': '(optional)',
    'modal.notes_placeholder': 'Ex: main account, alt for events, build, etc.',
    'modal.cancel': 'Cancel',
    'modal.save': 'Save',
    'toast.profile_deleted': 'Profile removed',
    'toast.name_required': 'Name is required',
    'toast.exported': 'Exported',
    'toast.imported': 'Imported',
    'toast.perfis': 'profiles',
    'toast.duplicated': 'Profile duplicated',
    'toast.favorited': 'Profile favorited',
    'toast.unfavorited': 'Profile unfavorited',
    'sort.name': 'Name (A-Z)',
    'sort.last_used': 'Last used',
    'sort.launch_count': 'Most used',
    'sort.play_time': 'Play time',
    'sort.created': 'Created',
    'settings.general': 'General',
    'settings.language': 'Language',
    'settings.language_desc': 'Launcher interface language',
    'settings.performance': 'Performance mode',
    'settings.performance_desc_default': 'Default: maximum safe optimization',
    'settings.performance_desc_lowpc': 'Low-end PC: reduces Flash quality to gain FPS',
    'settings.preferences': 'Preferences',
    delete_confirm: 'Delete this profile and its local data?'
  },

  de: {
    'setup.title': 'Willkommen beim Naruto Online Launcher',
    'setup.subtitle': 'Richten Sie Ihre Erfahrung in 30 Sekunden ein',
    'setup.language.label': 'Sprache',
    'setup.mode.title': 'Leistungsmodus',
    'setup.mode.default.body':
      'Für alle empfohlen — maximale sichere Optimierung. Immer vorteilhaft.',
    'setup.mode.lowpc.body':
      'Nur für schwache PCs (alte GPU oder weniger als 4GB RAM). Reduziert Flash-Visualqualität für mehr FPS. Kann auf modernen PCs schädlich sein.',
    'setup.save': 'Spielen starten',
    'mode.default': 'Optimierter Standard',
    'mode.lowpc': 'Schwacher PC Modus',
    'common.ram': 'RAM',
    'common.save': 'Speichern',
    'common.cancel': 'Abbrechen',
    'common.close': 'Schließen',
    'common.play': 'Spielen',
    'common.edit': 'Bearbeiten',
    'common.delete': 'Löschen',
    'common.settings': 'Einstellungen',
    'profile.name': 'Name',
    'profile.new': 'Neues Konto',
    'profile.empty': 'Keine Konten registriert',
    'profile.empty.hint': 'Klicken Sie auf "Neues Konto", um Ihr erstes Profil zu erstellen.'
  },

  es: {
    'setup.title': 'Bienvenido a Naruto Online Launcher',
    'setup.subtitle': 'Configura tu experiencia en 30 segundos',
    'setup.language.label': 'Idioma',
    'setup.mode.title': 'Modo de Rendimiento',
    'setup.mode.default.body':
      'Recomendado para todos — máxima optimización segura. Siempre beneficioso.',
    'setup.mode.lowpc.body':
      'Solo para PCs débiles (GPU antigua o menos de 4GB RAM). Reduce la calidad visual de Flash para ganar FPS. Puede ser perjudicial en PCs modernos.',
    'setup.save': 'Empezar a jugar',
    'mode.default': 'Predeterminado Optimizado',
    'mode.lowpc': 'Modo PC Débil',
    'common.ram': 'RAM',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.close': 'Cerrar',
    'common.play': 'Jugar',
    'common.edit': 'Editar',
    'common.delete': 'Eliminar',
    'common.settings': 'Configuración',
    'profile.name': 'Nombre',
    'profile.new': 'Nueva cuenta',
    'profile.empty': 'Sin cuentas registradas',
    'profile.empty.hint': 'Haz clic en "Nueva cuenta" para crear tu primer perfil.'
  },

  pl: {
    'setup.title': 'Witaj w Naruto Online Launcher',
    'setup.subtitle': 'Skonfiguruj swoje doświadczenie w 30 sekund',
    'setup.language.label': 'Język',
    'setup.mode.title': 'Tryb Wydajności',
    'setup.mode.default.body':
      'Zalecane dla wszystkich — maksymalna bezpieczna optymalizacja. Zawsze korzystne.',
    'setup.mode.lowpc.body':
      'Tylko dla słabych PC (stary GPU lub mniej niż 4GB RAM). Redukuje jakość wizualną Flash, aby zyskać FPS. Może być szkodliwe na nowoczesnych PC.',
    'setup.save': 'Rozpocznij grę',
    'mode.default': 'Optymalny Domyślny',
    'mode.lowpc': 'Tryb Słabego PC',
    'common.ram': 'RAM',
    'common.save': 'Zapisz',
    'common.cancel': 'Anuluj',
    'common.close': 'Zamknij',
    'common.play': 'Graj',
    'common.edit': 'Edytuj',
    'common.delete': 'Usuń',
    'common.settings': 'Ustawienia',
    'profile.name': 'Nazwa',
    'profile.new': 'Nowe konto',
    'profile.empty': 'Brak zarejestrowanych kont',
    'profile.empty.hint': 'Kliknij "Nowe konto", aby utworzyć swój pierwszy profil.'
  },

  fr: {
    'setup.title': 'Bienvenue sur Naruto Online Launcher',
    'setup.subtitle': 'Configurez votre expérience en 30 secondes',
    'setup.language.label': 'Langue',
    'setup.mode.title': 'Mode de Performance',
    'setup.mode.default.body':
      'Recommandé pour tous — optimisation sécurisée maximale. Toujours bénéfique.',
    'setup.mode.lowpc.body':
      'Uniquement pour PC faibles (ancien GPU ou moins de 4GB RAM). Réduit la qualité visuelle de Flash pour gagner en FPS. Peut être nuisible sur PC modernes.',
    'setup.save': 'Commencer à jouer',
    'mode.default': 'Défaut Optimisé',
    'mode.lowpc': 'Mode PC Faible',
    'common.ram': 'RAM',
    'common.save': 'Sauvegarder',
    'common.cancel': 'Annuler',
    'common.close': 'Fermer',
    'common.play': 'Jouer',
    'common.edit': 'Modifier',
    'common.delete': 'Supprimer',
    'common.settings': 'Paramètres',
    'profile.name': 'Nom',
    'profile.new': 'Nouveau compte',
    'profile.empty': 'Aucun compte enregistré',
    'profile.empty.hint': 'Cliquez sur "Nouveau compte" pour créer votre premier profil.'
  }
};

let _currentLang = DEFAULT_LANGUAGE;

/**
 * Define o idioma atual. Ignora silenciosamente se o idioma não existir no dicionário.
 * @param {string} lang locale code
 */
function setLanguage(lang) {
  if (DICTIONARY[lang]) {
    _currentLang = lang;
  }
}

/** Retorna o idioma atual. @returns {string} */
function getLanguage() {
  return _currentLang;
}

/** Translate a key using the current locale and Chinese fallback. */
function t(key) {
  const dict = DICTIONARY[_currentLang] || DICTIONARY[DEFAULT_LANGUAGE];
  return dict[key] || DICTIONARY[DEFAULT_LANGUAGE][key] || key;
}

/** Translate a key for a specific locale and use the Chinese fallback. */
function tl(key, lang) {
  const dict = DICTIONARY[lang] || DICTIONARY[DEFAULT_LANGUAGE];
  return dict[key] || DICTIONARY[DEFAULT_LANGUAGE][key] || key;
}

/** Retorna o dicionário completo para um idioma (ou o atual). @param {string} [lang] @returns {Object} */
function getAll(lang) {
  const l = lang || _currentLang;
  return DICTIONARY[l] || DICTIONARY[DEFAULT_LANGUAGE];
}

module.exports = {
  DEFAULT_LANGUAGE: DEFAULT_LANGUAGE,
  setLanguage: setLanguage,
  getLanguage: getLanguage,
  t: t,
  tl: tl,
  getAll: getAll,
  SUPPORTED: SUPPORTED
};
