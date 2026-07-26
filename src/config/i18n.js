/**
 * config/i18n.js — Internationalization ultra-leve
 * v2.1.0 — v5.9.15+ (settings.js restringe config.language a pt/en)
 *
 * Dicionário nativo sem dependências. ~8KB.
 * Strings organizadas por contexto: setup, settings, modes, common.
 *
 * NOTA: settings.js:validateConfig restringe config.language a 'pt' e 'en'.
 * Os dicionários de/de/es/pl/fr existem mas estão incompletos (apenas setup +
 * common). O IPC i18n:set-lang valida contra a lista completa (SUPPORTED).
 */

'use strict';

const DICTIONARY = {
  pt: {
    'setup.title': 'Bem-vindo ao Shinobi Launcher',
    'setup.subtitle': 'Configure sua experiência em 30 segundos',
    'setup.language.label': 'Idioma',
    'setup.mode.title': 'Modo de Desempenho',
    'setup.mode.default.body':
      'Recomendado para todos — máxima otimização segura. Sempre benéfico.',
    'setup.mode.lowpc.body':
      'Apenas para PCs fracos (GPU antiga ou menos de 4GB RAM). Reduz qualidade visual do Flash para ganhar FPS. Pode ser prejudicial em PCs modernos.',
    'setup.save': 'Começar a jogar',
    'mode.default': 'Padrão Otimizado',
    'mode.lowpc': 'Modo PC Fraco',
    'common.ram': 'RAM',
    'common.save': 'Salvar',
    'common.cancel': 'Cancelar',
    'common.close': 'Fechar',
    'common.play': 'Jogar',
    'common.edit': 'Editar',
    'common.delete': 'Excluir',
    'common.settings': 'Configurações',
    'profile.name': 'Nome',
    'profile.new': 'Nova conta',
    'profile.empty': 'Nenhuma conta cadastrada',
    'profile.empty.hint': 'Clique em "Nova conta" para criar seu primeiro perfil.',
    // v4.6: Launcher UI strings
    'nav.accounts': 'Contas',
    'nav.settings': 'Configurações',
    'topbar.new': 'Nova conta',
    'topbar.last_profile': 'Relançar último perfil',
    'topbar.view_grid': 'Visualização em grade',
    'topbar.view_list': 'Visualização em lista',
    'search.placeholder': 'Buscar perfil por nome...',
    'search.no_results': 'Nenhum resultado para',
    'card.play': 'Play',
    'card.edit': 'Editar',
    'card.delete': 'Excluir',
    'card.duplicate': 'Duplicar',
    'card.favorite': 'Favoritar',
    'card.unfavorite': 'Desfavoritar',
    'card.open': 'aberta',
    'card.status.idle': 'pronto',
    'card.status.loading': 'preenchendo',
    'card.status.success': 'logado',
    'card.status.error': 'falhou',
    'modal.edit_title': 'Editar conta',
    'modal.new_title': 'Nova conta',
    'modal.notes': 'Notas',
    'modal.notes_optional': '(opcional)',
    'modal.notes_placeholder': 'Ex: conta principal, alt para eventos, build, etc.',
    'modal.cancel': 'Cancelar',
    'modal.save': 'Salvar',
    'toast.profile_deleted': 'Perfil removido',
    'toast.name_required': 'Informe um nome',
    'toast.exported': 'Exportado',
    'toast.imported': 'Importados',
    'toast.perfis': 'perfis',
    'toast.duplicated': 'Perfil duplicado',
    'toast.favorited': 'Perfil favoritado',
    'toast.unfavorited': 'Perfil desfavoritado',
    'sort.name': 'Nome (A-Z)',
    'sort.last_used': 'Último uso',
    'sort.launch_count': 'Mais usado',
    'sort.play_time': 'Tempo de jogo',
    'sort.created': 'Criação',
    'settings.general': 'Geral',
    'settings.language': 'Idioma',
    'settings.language_desc': 'Idioma da interface do launcher',
    'settings.performance': 'Modo de desempenho',
    'settings.performance_desc_default': 'Padrão: máxima otimização segura',
    'settings.performance_desc_lowpc': 'PC Fraco: reduz qualidade do Flash para ganhar FPS',
    'settings.preferences': 'Preferências',
    delete_confirm: 'Excluir este perfil e seus dados locais?'
  },

  en: {
    'setup.title': 'Welcome to Shinobi Launcher',
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
    'setup.title': 'Willkommen beim Shinobi Launcher',
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
    'setup.title': 'Bienvenido a Shinobi Launcher',
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
    'setup.title': 'Witaj w Shinobi Launcher',
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
    'setup.title': 'Bienvenue sur Shinobi Launcher',
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

let _currentLang = 'pt';

/**
 * Define o idioma atual. Ignora silenciosamente se o idioma não existir no dicionário.
 * @param {string} lang — código do idioma (ex: 'pt', 'en')
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

/** Traduz uma chave para o idioma atual, com fallback para pt. @param {string} key @returns {string} */
function t(key) {
  const dict = DICTIONARY[_currentLang] || DICTIONARY.pt;
  return dict[key] || DICTIONARY.pt[key] || key;
}

/** Traduz uma chave para um idioma específico, com fallback para pt. @param {string} key @param {string} lang @returns {string} */
function tl(key, lang) {
  const dict = DICTIONARY[lang] || DICTIONARY.pt;
  return dict[key] || DICTIONARY.pt[key] || key;
}

/** Retorna o dicionário completo para um idioma (ou o atual). @param {string} [lang] @returns {Object} */
function getAll(lang) {
  const l = lang || _currentLang;
  return DICTIONARY[l] || DICTIONARY.pt;
}

module.exports = {
  setLanguage: setLanguage,
  getLanguage: getLanguage,
  t: t,
  tl: tl,
  getAll: getAll,
  SUPPORTED: ['pt', 'en', 'de', 'es', 'pl', 'fr']
};
