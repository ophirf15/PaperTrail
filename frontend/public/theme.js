try {
  var theme = localStorage.getItem('pt-theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
} catch (e) {}
